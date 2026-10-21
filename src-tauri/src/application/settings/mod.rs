//! 设置用例:应用设置读写(部分更新 + 校验)与布局持久化(PRD §6.7、设计文档 §7.3)。
//!
//! 设置形状即 IPC 契约(单一来源,`dto::settings` 直接复用本模块类型);
//! 取值区间/候选值/单位由 [`schema`] 登记,校验与设置界面同源于那张表;
//! 布局是前端表示层状态,后端仅做"必须是对象 + 体积上限"的边界校验后透传持久化。

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ports::{SettingsStore, StoreError};

pub mod schema;

#[cfg(test)]
mod tests;

/// 布局 JSON 体积上限(字节),防止异常载荷撑爆配置文件。
const MAX_LAYOUT_BYTES: usize = 256 * 1024;

/// 设置应用错误。
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum SettingsError {
    /// 持久化失败。
    #[error("{0}")]
    Storage(#[from] StoreError),
    /// 内容非法(解析失败、越界或含契约外字段);`details` 携带可定位到具体设置项的结构化上下文。
    #[error("{message}")]
    Invalid {
        /// 中文提示(前端可直接展示,亦可按 details 本地化)。
        message: String,
        /// 结构化详情(违规项 / 契约外路径);非结构化错误为 None。必须脱敏。
        details: Option<Value>,
    },
}

impl SettingsError {
    /// 构造无详情的非法设置错误。
    fn invalid(message: impl Into<String>) -> Self {
        Self::Invalid {
            message: message.into(),
            details: None,
        }
    }

    /// 由 schema 违规项构造错误(详情随错误下发,供前端定位控件)。
    fn violations(violations: &[schema::SettingViolation]) -> Self {
        Self::Invalid {
            message: schema::violation_message(violations),
            details: serde_json::to_value(violations).ok(),
        }
    }

    /// 由契约外路径构造错误(补丁写了不存在的设置项)。
    fn unknown_paths(paths: &[String]) -> Self {
        Self::Invalid {
            message: schema::unknown_paths_message(paths),
            details: serde_json::to_value(paths).ok(),
        }
    }
}

/// 主题模式。
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    /// 跟随系统(默认)。
    #[default]
    System,
    /// 深色。
    Dark,
    /// 浅色。
    Light,
}

impl ThemeMode {
    /// 全部候选值(顺序即设置界面顺序;schema 与测试由此派生)。
    pub const ALL: &'static [Self] = &[Self::System, Self::Dark, Self::Light];
}

/// 界面语言。
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    /// 简体中文(默认,P0)。
    #[default]
    Zh,
    /// 英文(M4)。
    En,
}

impl Language {
    /// 全部候选值(界面语言尚未实现 i18n,仅在契约中保留)。
    pub const ALL: &'static [Self] = &[Self::Zh, Self::En];
}

/// 光标样式。
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum CursorStyle {
    /// 竖线(默认)。
    #[default]
    Bar,
    /// 块。
    Block,
    /// 下划线。
    Underline,
}

impl CursorStyle {
    /// 全部候选值。
    pub const ALL: &'static [Self] = &[Self::Bar, Self::Block, Self::Underline];
}

/// 终端配色方案(PRD 用户故事 19;GitHub Light 为默认)。
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum TerminalColorScheme {
    /// Dracula。
    Dracula,
    /// Tokyo Night。
    TokyoNight,
    /// One Dark。
    OneDark,
    /// Nord。
    Nord,
    /// Solarized Dark。
    SolarizedDark,
    /// Solarized Light。
    SolarizedLight,
    /// GitHub Light(默认);旧配置的 "default" 迁移到此方案。
    #[default]
    #[serde(alias = "default")]
    GithubLight,
}

impl TerminalColorScheme {
    /// 全部候选值(顺序即设置界面顺序)。
    pub const ALL: &'static [Self] = &[
        Self::Dracula,
        Self::TokyoNight,
        Self::OneDark,
        Self::Nord,
        Self::SolarizedDark,
        Self::SolarizedLight,
        Self::GithubLight,
    ];
}

/// 默认认证方式(取值与连接契约一致)。
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum DefaultAuthMethod {
    /// 账号密码(默认)。
    #[default]
    Password,
    /// 私钥。
    PrivateKey,
    /// 键盘交互。
    KeyboardInteractive,
    /// 免密。
    Agent,
}

impl DefaultAuthMethod {
    /// 全部候选值(顺序即设置界面顺序)。
    pub const ALL: &'static [Self] = &[
        Self::Password,
        Self::PrivateKey,
        Self::KeyboardInteractive,
        Self::Agent,
    ];
}

/// 传输冲突默认策略(取值与传输契约一致)。
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum ConflictPolicy {
    /// 每次询问(默认)。
    #[default]
    Ask,
    /// 覆盖。
    Overwrite,
    /// 跳过。
    Skip,
    /// 两者都保留(自动重命名)。
    Rename,
}

impl ConflictPolicy {
    /// 全部候选值(顺序即设置界面顺序)。
    pub const ALL: &'static [Self] = &[Self::Ask, Self::Overwrite, Self::Skip, Self::Rename];
}

/// 外观设置。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct AppearanceSettings {
    /// 主题。
    pub theme: ThemeMode,
    /// 语言。
    pub language: Language,
}

/// 终端默认设置(PRD §6.7)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct TerminalSettings {
    /// 字体族。
    pub font_family: String,
    /// 字号(px)。
    pub font_size: u8,
    /// 行距倍数(f64:f32 会把 1.2 序列化成交货污染的契约值 1.2000000476837158)。
    pub line_height: f64,
    /// 配色方案。
    pub color_scheme: TerminalColorScheme,
    /// 光标样式。
    pub cursor_style: CursorStyle,
    /// 回滚缓冲行数。
    pub scrollback: u32,
    /// 选中即复制。
    pub copy_on_select: bool,
    /// 右键粘贴。
    pub right_click_paste: bool,
    /// 关闭标签确认。
    pub confirm_close_tab: bool,
}

/// 连接默认设置。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct ConnectionSettings {
    /// keepalive 间隔(秒),0 = 关闭。
    pub keepalive_interval_secs: u32,
    /// 默认认证方式。
    pub default_auth_method: DefaultAuthMethod,
}

/// 传输默认设置。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct TransferSettings {
    /// 全局并发任务数上限。
    pub max_concurrent_tasks: u8,
    /// 单请求分块大小(KiB,高级项)。
    pub chunk_size_kib: u32,
    /// 冲突默认策略。
    pub default_conflict_policy: ConflictPolicy,
    /// 传输完成通知。
    pub notify_on_complete: bool,
}

/// 监控默认设置。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct MonitorSettings {
    /// 默认采样间隔(秒)。
    pub default_interval_secs: u32,
}

/// 更新设置(PRD #66:自动检查更新可关闭)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateSettings {
    /// 自动检查更新;关闭后后台循环跳过网络请求。
    pub auto_check: bool,
}

/// Agent 设置(M5,docs/AGENT_DESIGN.md)。
///
/// 区间与档位只在 [`schema`] 登记一次,校验与界面下拉同源;
/// 这里只定义字段与默认值,禁止在别处复制一份取值范围。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentSettings {
    /// 单轮最多允许多少次工具往返。
    pub max_turns: u32,
    /// 每次请求携带的历史消息条数(上下文窗口)。
    pub context_messages: u32,
    /// 单次批量操作的主机数上限。
    pub batch_limit: u32,
    /// 同时执行的主机数上限。
    pub parallel_hosts: u32,
    /// 单条远端命令超时(秒)。
    pub exec_timeout_secs: u32,
    /// 审批档位。
    pub approval_mode: crate::domain::agent::ApprovalMode,
    /// 单对话 token 预算;0 表示不限。
    pub token_budget: u32,
    /// 是否把共享记忆注入系统提示。
    pub inject_memories: bool,
    /// 是否展示模型推理增量( provider 返回时)。
    pub show_reasoning: bool,
}

impl Default for AgentSettings {
    /// Agent 分组默认值:只读自动、批量 5 台、并发 4、超时 30s、预算 20 万 token。
    fn default() -> Self {
        Self {
            max_turns: 12,
            context_messages: 30,
            batch_limit: 5,
            parallel_hosts: 4,
            exec_timeout_secs: 30,
            approval_mode: crate::domain::agent::ApprovalMode::ReadOnlyAuto,
            token_budget: 200_000,
            inject_memories: true,
            show_reasoning: true,
        }
    }
}

/// 数据迁移状态(设计文档 §7.1);由迁移用例与启动流程维护,设置页只读展示。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct MigrationSettings {
    /// 已批准、待下次启动早期执行的迁移 id;执行成功后由启动流程清除。
    pub pending_migration_id: Option<String>,
    /// 用户点「暂不」后不再自动弹窗的迁移 id;设置页手动入口不受此影响。
    pub dismissed_auto_migrations: Vec<String>,
}

/// 应用设置全集(PRD §6.7 分组);默认值 = 各分组默认值的组合。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// 外观。
    pub appearance: AppearanceSettings,
    /// 终端。
    pub terminal: TerminalSettings,
    /// 连接。
    pub connection: ConnectionSettings,
    /// 传输。
    pub transfer: TransferSettings,
    /// 监控。
    pub monitor: MonitorSettings,
    /// 更新。
    pub update: UpdateSettings,
    /// AI Agent(M5)。
    pub agent: AgentSettings,
    /// 数据迁移。
    pub migration: MigrationSettings,
}

impl Default for TerminalSettings {
    /// 终端分组默认值(PRD §6.3/§6.7)。
    fn default() -> Self {
        Self {
            font_family: "Cascadia Mono, Consolas, monospace".into(),
            font_size: 13,
            line_height: 1.2,
            color_scheme: TerminalColorScheme::GithubLight,
            cursor_style: CursorStyle::Bar,
            scrollback: 5000,
            copy_on_select: true,
            right_click_paste: true,
            confirm_close_tab: true,
        }
    }
}

impl Default for ConnectionSettings {
    /// 连接分组默认值:keepalive 30s(PRD §6.3)。
    fn default() -> Self {
        Self {
            keepalive_interval_secs: 30,
            default_auth_method: DefaultAuthMethod::Password,
        }
    }
}

impl Default for TransferSettings {
    /// 传输分组默认值:并发 2、分块 32KiB(PRD §6.4)。
    fn default() -> Self {
        Self {
            max_concurrent_tasks: 2,
            chunk_size_kib: 32,
            default_conflict_policy: ConflictPolicy::Ask,
            notify_on_complete: false,
        }
    }
}

impl Default for MonitorSettings {
    /// 监控分组默认值:采样间隔 5s(PRD §6.5)。
    fn default() -> Self {
        Self {
            default_interval_secs: 5,
        }
    }
}

impl Default for UpdateSettings {
    /// 更新分组默认值:开启自动检查(PRD #66)。
    fn default() -> Self {
        Self { auto_check: true }
    }
}

impl AppSettings {
    /// 校验取值边界:区间只定义一次(见 [`schema`]),设置界面档位同源。
    pub fn validate(&self) -> Result<(), SettingsError> {
        let tree = serde_json::to_value(self)
            .map_err(|e| SettingsError::invalid(format!("设置序列化失败: {e}")))?;
        match schema::validate_values(&tree) {
            schema::SchemaCheck::Ok => Ok(()),
            schema::SchemaCheck::Violations(violations) => {
                Err(SettingsError::violations(&violations))
            }
            schema::SchemaCheck::UnknownPaths(paths) => Err(SettingsError::unknown_paths(&paths)),
        }
    }
}

/// 设置应用服务。
pub struct SettingsService {
    store: Box<dyn SettingsStore>,
}

impl SettingsService {
    /// 以持久化端口构建服务。
    pub fn new(store: Box<dyn SettingsStore>) -> Self {
        Self { store }
    }

    /// 读取设置;从未保存或部分字段缺失时回退默认值。
    pub fn get(&self) -> Result<AppSettings, SettingsError> {
        let Some(raw) = self.store.load_settings()? else {
            return Ok(AppSettings::default());
        };
        let settings: AppSettings = serde_json::from_str(&raw)
            .map_err(|e| SettingsError::invalid(format!("设置文件损坏: {e}")))?;
        settings.validate()?;
        Ok(settings)
    }

    /// 以 JSON 对象补丁部分更新设置;返回更新后的全量设置。
    ///
    /// 补丁先按契约 schema 校验:字段名写错(过去会被 serde 当未知字段静默丢弃,
    /// 从而变成"改了没反应"的假开关)或取值越界,都在这里直接拒绝并回传定位信息。
    pub fn update(&self, patch: serde_json::Value) -> Result<AppSettings, SettingsError> {
        if !patch.is_object() {
            return Err(SettingsError::invalid("设置补丁必须是对象"));
        }
        match schema::validate_patch(&patch) {
            schema::SchemaCheck::Ok => {}
            schema::SchemaCheck::Violations(violations) => {
                return Err(SettingsError::violations(&violations));
            }
            schema::SchemaCheck::UnknownPaths(paths) => {
                return Err(SettingsError::unknown_paths(&paths));
            }
        }
        let current =
            serde_json::to_value(self.get()?).map_err(|e| SettingsError::invalid(e.to_string()))?;
        let merged = merge_objects(current, patch);
        let settings: AppSettings = serde_json::from_value(merged)
            .map_err(|e| SettingsError::invalid(format!("设置字段非法: {e}")))?;
        settings.validate()?;
        let raw =
            serde_json::to_string(&settings).map_err(|e| SettingsError::invalid(e.to_string()))?;
        self.store.save_settings(&raw)?;
        Ok(settings)
    }

    /// 读取布局(前端表示层状态;未保存时返回空对象)。
    pub fn layout(&self) -> Result<serde_json::Value, SettingsError> {
        let Some(raw) = self.store.load_layout()? else {
            return Ok(serde_json::json!({}));
        };
        serde_json::from_str(&raw).map_err(|e| SettingsError::invalid(format!("布局文件损坏: {e}")))
    }

    /// 保存布局;仅接受对象形态并限制体积。
    pub fn save_layout(&self, layout: serde_json::Value) -> Result<(), SettingsError> {
        if !layout.is_object() {
            return Err(SettingsError::invalid("布局必须是对象"));
        }
        let raw =
            serde_json::to_string(&layout).map_err(|e| SettingsError::invalid(e.to_string()))?;
        if raw.len() > MAX_LAYOUT_BYTES {
            return Err(SettingsError::invalid("布局数据过大"));
        }
        self.store.save_layout(&raw)?;
        Ok(())
    }
}

/// 递归合并 JSON 对象:对象逐键深合并,其余类型整体替换。
fn merge_objects(base: serde_json::Value, patch: serde_json::Value) -> serde_json::Value {
    let (Some(mut base_map), Some(patch_map)) =
        (base.as_object().cloned(), patch.as_object().cloned())
    else {
        return patch;
    };
    for (key, value) in patch_map {
        let merged = match (base_map.get(&key).cloned(), &value) {
            (Some(old), new) if old.is_object() && new.is_object() => merge_objects(old, value),
            _ => value,
        };
        base_map.insert(key, merged);
    }
    serde_json::Value::Object(base_map)
}
