//! 设置项契约 schema:字段路径、类型、取值区间、候选值与单位的**唯一定义**(AGENTS.md §5)。
//!
//! 治理三类漂移(第一类已真实发生):
//! 1. 字段名:前端手写 `chunkSizeKiB`,而 Rust `rename_all="camelCase"` 实际产出
//!    `chunkSizeKib` → 前端读到 undefined、写入被 serde 当未知字段静默丢弃,
//!    该设置项长期是假开关。现在界面按本 schema 的 `path` 渲染与提交,
//!    字段名不再在前端出现,补丁也会拒绝契约外路径。
//! 2. 取值区间:原先只写在 `AppSettings::validate`,前端另抄一份档位常量,两边各改各的。
//!    现在校验与界面档位同源于本表。
//! 3. 候选值:枚举选项由 Rust 枚举自身的 `ALL` 派生,不手写字符串列表。
//!
//! 本模块只描述契约,不持有用户可见文案;label/hint 属表现层(前端 copy 表)。

use serde::Serialize;
use serde_json::Value;

use super::{
    AppSettings, ConflictPolicy, CursorStyle, DefaultAuthMethod, Language, ShowShortcut,
    TerminalColorScheme, ThemeMode,
};

/// 滚动缓冲行数上限(PRD §6.3:默认 5000,最大 100000)。
const MAX_SCROLLBACK: i64 = 100_000;

/// 设置项类型与取值约束。
#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SettingKind {
    /// 整数;`presets` 为界面档位(必须落在 [min,max] 内,由测试保证)。
    #[serde(rename_all = "camelCase")]
    Int {
        /// 最小值(含)。
        min: i64,
        /// 最大值(含)。
        max: i64,
        /// 界面档位。
        presets: Vec<i64>,
    },
    /// 浮点;`presets` 为界面档位。
    #[serde(rename_all = "camelCase")]
    Float {
        /// 最小值(含)。
        min: f64,
        /// 最大值(含)。
        max: f64,
        /// 界面档位。
        presets: Vec<f64>,
    },
    /// 枚举,候选值来自 Rust 枚举自身。
    #[serde(rename_all = "camelCase")]
    Enum {
        /// 候选值(serde 字面量,顺序即界面顺序)。
        options: Vec<String>,
    },
    /// 布尔开关。
    #[serde(rename = "bool")]
    Bool,
    /// 自由文本(候选项等界面资产由前端提供,后端只约束长度)。
    #[serde(rename_all = "camelCase")]
    Text {
        /// 最大字符数。
        max_len: usize,
    },
    /// 契约存在但不供设置界面编辑(由应用内部用例维护)。
    #[serde(rename = "hidden")]
    Hidden,
}

/// 设置项标量取值:契约里只承载渲染与提示需要的标量,不暴露任意 JSON 结构。
#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(untagged)]
pub enum SettingScalar {
    /// 文本(枚举字面量、字体栈、脱敏回显等)。
    Text(String),
    /// 数值。
    Number(f64),
    /// 布尔开关。
    Flag(bool),
    /// 字符串列表(仅内部维护项,如已「暂不」的迁移 id)。
    List(Vec<String>),
}

/// 单个设置项契约。
#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettingSpec {
    /// 完整路径,如 `transfer.chunkSizeKib`;与 serde 产物逐字一致。
    pub path: String,
    /// 所属分组(顶层对象名)。
    pub group: String,
    /// 数值单位(用于组装可读提示);非数值项为 None。
    pub unit: Option<String>,
    /// 类型与约束。
    pub kind: SettingKind,
    /// 默认值(取自 `AppSettings::default()` 的序列化结果,不可能与实现漂移);
    /// 内部维护项为 null。
    pub default: Option<SettingScalar>,
}

/// 校验违规项(随 IPC `details` 下发,前端据此把错误定位到具体控件)。
#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettingViolation {
    /// 违规设置项路径。
    pub path: String,
    /// 允许下界;非区间类为 None。
    pub min: Option<f64>,
    /// 允许上界;非区间类为 None。
    pub max: Option<f64>,
    /// 单位。
    pub unit: Option<String>,
    /// 实际收到的值(脱敏:字符串只报长度,不回显内容)。
    pub received: SettingScalar,
}

/// Schema 校验结果。
#[derive(Debug, Clone, PartialEq)]
pub enum SchemaCheck {
    /// 通过。
    Ok,
    /// 存在越界、类型不符或候选值非法的项。
    Violations(Vec<SettingViolation>),
    /// 包含契约外的路径(过去会被 serde 静默丢弃,现在直接拒绝)。
    UnknownPaths(Vec<String>),
}

/// 内部登记项(默认值运行时从真实契约树取,不在这里手写)。
struct RawSpec {
    path: &'static str,
    unit: Option<&'static str>,
    kind: SettingKind,
}

/// 枚举候选值(按 serde 字面量)。
fn enum_values<T: Serialize + Copy>(all: &[T]) -> Vec<String> {
    all.iter()
        .map(|value| {
            serde_json::to_value(value)
                .ok()
                .and_then(|json| json.as_str().map(str::to_owned))
                .unwrap_or_else(|| panic!("设置枚举必须序列化为字符串"))
        })
        .collect()
}

/// 整数区间构造。
fn ints(min: i64, max: i64, presets: &'static [i64]) -> SettingKind {
    SettingKind::Int {
        min,
        max,
        presets: presets.to_vec(),
    }
}

/// 设置项登记表(顺序即建议渲染顺序)。
fn raw_specs() -> Vec<RawSpec> {
    vec![
        RawSpec {
            path: "appearance.theme",
            unit: None,
            kind: SettingKind::Enum {
                options: enum_values(ThemeMode::ALL),
            },
        },
        RawSpec {
            path: "appearance.language",
            unit: None,
            kind: SettingKind::Enum {
                options: enum_values(Language::ALL),
            },
        },
        RawSpec {
            path: "terminal.fontFamily",
            unit: Some("字符"),
            kind: SettingKind::Text { max_len: 200 },
        },
        RawSpec {
            path: "terminal.fontSize",
            unit: Some("px"),
            kind: ints(8, 32, &[10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32]),
        },
        RawSpec {
            path: "terminal.lineHeight",
            unit: None,
            kind: SettingKind::Float {
                min: 1.0,
                max: 2.0,
                presets: vec![1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0],
            },
        },
        RawSpec {
            path: "terminal.colorScheme",
            unit: None,
            kind: SettingKind::Enum {
                options: enum_values(TerminalColorScheme::ALL),
            },
        },
        RawSpec {
            path: "terminal.cursorStyle",
            unit: None,
            kind: SettingKind::Enum {
                options: enum_values(CursorStyle::ALL),
            },
        },
        RawSpec {
            path: "terminal.scrollback",
            unit: Some("行"),
            kind: ints(
                100,
                MAX_SCROLLBACK,
                &[1000, 5000, 10000, 50000, MAX_SCROLLBACK],
            ),
        },
        RawSpec {
            path: "terminal.copyOnSelect",
            unit: None,
            kind: SettingKind::Bool,
        },
        RawSpec {
            path: "terminal.rightClickPaste",
            unit: None,
            kind: SettingKind::Bool,
        },
        RawSpec {
            path: "terminal.confirmCloseTab",
            unit: None,
            kind: SettingKind::Bool,
        },
        RawSpec {
            path: "connection.keepaliveIntervalSecs",
            unit: Some("秒"),
            kind: ints(0, 600, &[0, 15, 30, 60, 120, 300, 600]),
        },
        RawSpec {
            path: "connection.defaultAuthMethod",
            unit: None,
            kind: SettingKind::Enum {
                options: enum_values(DefaultAuthMethod::ALL),
            },
        },
        RawSpec {
            path: "transfer.maxConcurrentTasks",
            unit: Some("个"),
            kind: ints(1, 8, &[1, 2, 3, 4, 5, 6, 7, 8]),
        },
        RawSpec {
            path: "transfer.chunkSizeKib",
            unit: Some("KiB"),
            kind: ints(4, 1024, &[16, 32, 64, 128, 256, 1024]),
        },
        RawSpec {
            path: "transfer.defaultConflictPolicy",
            unit: None,
            kind: SettingKind::Enum {
                options: enum_values(ConflictPolicy::ALL),
            },
        },
        RawSpec {
            path: "transfer.notifyOnComplete",
            unit: None,
            kind: SettingKind::Bool,
        },
        RawSpec {
            path: "monitor.defaultIntervalSecs",
            unit: Some("秒"),
            kind: ints(2, 60, &[2, 5, 10, 30, 60]),
        },
        RawSpec {
            path: "update.autoCheck",
            unit: None,
            kind: SettingKind::Bool,
        },
        RawSpec {
            path: "window.closeToTray",
            unit: None,
            kind: SettingKind::Bool,
        },
        RawSpec {
            path: "window.launchAtStartup",
            unit: None,
            kind: SettingKind::Bool,
        },
        RawSpec {
            path: "window.showShortcut",
            unit: None,
            kind: SettingKind::Enum {
                options: enum_values(ShowShortcut::ALL),
            },
        },
        RawSpec {
            path: "window.systemNotifications",
            unit: None,
            kind: SettingKind::Bool,
        },
        // ---- Agent(M5)docs/AGENT_DESIGN.md §11.3 ----
        RawSpec {
            path: "agent.approvalMode",
            unit: None,
            kind: SettingKind::Enum {
                options: enum_values(&crate::domain::agent::ApprovalMode::ALL),
            },
        },
        RawSpec {
            path: "agent.maxTurns",
            unit: Some("轮"),
            kind: ints(1, 60, &[4, 8, 12, 20, 40]),
        },
        RawSpec {
            path: "agent.contextMessages",
            unit: Some("条"),
            kind: ints(2, 400, &[10, 30, 60, 120]),
        },
        RawSpec {
            path: "agent.batchLimit",
            unit: Some("台"),
            kind: ints(1, 20, &[1, 5, 10, 20]),
        },
        RawSpec {
            path: "agent.parallelHosts",
            unit: Some("台"),
            kind: ints(1, 8, &[1, 2, 4, 8]),
        },
        RawSpec {
            path: "agent.execTimeoutSecs",
            unit: Some("秒"),
            kind: ints(1, 120, &[10, 30, 60, 120]),
        },
        RawSpec {
            path: "agent.tokenBudget",
            unit: Some("tokens"),
            kind: ints(0, 5_000_000, &[0, 50_000, 200_000, 1_000_000, 5_000_000]),
        },
        RawSpec {
            path: "agent.injectMemories",
            unit: None,
            kind: SettingKind::Bool,
        },
        RawSpec {
            path: "agent.showReasoning",
            unit: None,
            kind: SettingKind::Bool,
        },
        RawSpec {
            path: "migration.pendingMigrationId",
            unit: None,
            kind: SettingKind::Hidden,
        },
        RawSpec {
            path: "migration.dismissedAutoMigrations",
            unit: None,
            kind: SettingKind::Hidden,
        },
    ]
}

/// 把序列化树上的值转成契约标量;null 与未知形态返回 None。
fn scalar_of(value: Option<&Value>) -> Option<SettingScalar> {
    match value? {
        Value::Null => None,
        Value::Bool(flag) => Some(SettingScalar::Flag(*flag)),
        Value::Number(number) => number.as_f64().map(SettingScalar::Number),
        Value::String(text) => Some(SettingScalar::Text(text.clone())),
        Value::Array(items) => Some(SettingScalar::List(
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect(),
        )),
        Value::Object(_) => None,
    }
}

/// 返回全部设置项契约,默认值取自真实序列化树。
pub fn settings_schema() -> Vec<SettingSpec> {
    let tree = serde_json::to_value(AppSettings::default()).expect("设置默认值必须可序列化");
    raw_specs()
        .into_iter()
        .map(|raw| SettingSpec {
            default: scalar_of(pick(&tree, raw.path)),
            group: raw.path.split('.').next().unwrap_or_default().to_owned(),
            path: raw.path.to_owned(),
            unit: raw.unit.map(str::to_owned),
            kind: raw.kind,
        })
        .collect()
}

/// 全部登记路径(供覆盖性测试使用)。
pub fn schema_paths() -> Vec<String> {
    raw_specs()
        .into_iter()
        .map(|spec| spec.path.to_owned())
        .collect()
}

/// 按点分路径取值。
pub fn pick<'a>(tree: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = tree;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    Some(current)
}

/// 按 schema 校验已序列化的设置树取值边界(区间只在本表定义一次)。
pub fn validate_values(tree: &Value) -> SchemaCheck {
    let mut violations = Vec::new();
    for raw in raw_specs() {
        let Some(value) = pick(tree, raw.path) else {
            violations.push(SettingViolation {
                path: raw.path.to_owned(),
                min: None,
                max: None,
                unit: raw.unit.map(str::to_owned),
                received: SettingScalar::Text("字段缺失".into()),
            });
            continue;
        };
        if let Some(violation) = check_one(raw.path, &raw.kind, raw.unit, value) {
            violations.push(violation);
        }
    }
    if violations.is_empty() {
        SchemaCheck::Ok
    } else {
        SchemaCheck::Violations(violations)
    }
}

/// 校验补丁:只接受契约内路径,并复检候选值/类型/区间。
pub fn validate_patch(patch: &Value) -> SchemaCheck {
    let Some(map) = patch.as_object() else {
        return SchemaCheck::UnknownPaths(vec!["<补丁不是对象>".into()]);
    };
    let specs = settings_schema();
    let mut unknown = Vec::new();
    let mut violations = Vec::new();
    for (group, subtree) in map {
        let Some(group_obj) = subtree.as_object() else {
            unknown.push(group.clone());
            continue;
        };
        for (key, value) in group_obj {
            let path = format!("{group}.{key}");
            let Some(spec) = specs.iter().find(|s| s.path == path) else {
                unknown.push(path);
                continue;
            };
            if let Some(violation) = check_one(&path, &spec.kind, spec.unit.as_deref(), value) {
                violations.push(violation);
            }
        }
    }
    if !unknown.is_empty() {
        return SchemaCheck::UnknownPaths(unknown);
    }
    if !violations.is_empty() {
        return SchemaCheck::Violations(violations);
    }
    SchemaCheck::Ok
}

/// 校验单个取值。
fn check_one(
    path: &str,
    kind: &SettingKind,
    unit: Option<&str>,
    value: &Value,
) -> Option<SettingViolation> {
    let violation = |min: Option<f64>, max: Option<f64>| SettingViolation {
        path: path.to_owned(),
        min,
        max,
        unit: unit.map(str::to_owned),
        received: describe(value),
    };
    match kind {
        SettingKind::Int { min, max, .. } => match value.as_i64() {
            Some(v) if v >= *min && v <= *max => None,
            _ => Some(violation(Some(*min as f64), Some(*max as f64))),
        },
        SettingKind::Float { min, max, .. } => match value.as_f64() {
            Some(v) if v >= *min && v <= *max => None,
            _ => Some(violation(Some(*min), Some(*max))),
        },
        SettingKind::Enum { options } => match value.as_str() {
            Some(v) if options.iter().any(|option| option == v) => None,
            _ => Some(violation(None, None)),
        },
        SettingKind::Bool => {
            if value.is_boolean() {
                None
            } else {
                Some(violation(None, None))
            }
        }
        SettingKind::Text { max_len } => match value.as_str() {
            Some(v) if v.chars().count() <= *max_len => None,
            _ => Some(violation(Some(0.0), Some(*max_len as f64))),
        },
        SettingKind::Hidden => None,
    }
}

/// 把收到的值缩成可安全回显的标量。
fn describe(value: &Value) -> SettingScalar {
    match value {
        Value::String(s) => SettingScalar::Text(format!("<字符串 长度 {}>", s.chars().count())),
        Value::Bool(flag) => SettingScalar::Flag(*flag),
        Value::Number(number) => SettingScalar::Number(number.as_f64().unwrap_or_default()),
        other => SettingScalar::Text(other.to_string()),
    }
}

/// 组装首个违规的中文提示(细节随 `details` 一并下发)。
pub fn violation_message(violations: &[SettingViolation]) -> String {
    let Some(first) = violations.first() else {
        return "设置取值非法".into();
    };
    if let (Some(min), Some(max)) = (first.min, first.max) {
        let unit = first
            .unit
            .as_deref()
            .map(|unit| {
                if unit.is_empty() {
                    String::new()
                } else {
                    format!(" {unit}")
                }
            })
            .unwrap_or_default();
        return format!("{} 必须在 {}–{}{} 之间", first.path, min, max, unit);
    }
    format!("{} 的取值不在允许范围内", first.path)
}

/// 契约外路径的提示。
pub fn unknown_paths_message(paths: &[String]) -> String {
    format!("设置项不存在:{}", paths.join("、"))
}

#[cfg(test)]
#[path = "schema_tests.rs"]
mod tests;
