//! 设置用例:应用设置读写(部分更新 + 校验)与布局持久化(PRD §6.7、设计文档 §7.3)。
//!
//! 设置形状即 IPC 契约(单一来源,`dto::settings` 直接复用本模块类型);
//! 布局是前端表示层状态,后端仅做"必须是对象 + 体积上限"的边界校验后透传持久化。

use serde::{Deserialize, Serialize};

use super::ports::{SettingsStore, StoreError};

#[cfg(test)]
mod tests;

/// 滚动缓冲行数上限(PRD §6.3:默认 5000,最大 100000)。
const MAX_SCROLLBACK: u32 = 100_000;
/// 布局 JSON 体积上限(字节),防止异常载荷撑爆配置文件。
const MAX_LAYOUT_BYTES: usize = 256 * 1024;

/// 设置应用错误。
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum SettingsError {
    /// 持久化失败。
    #[error("{0}")]
    Storage(#[from] StoreError),
    /// 内容非法(解析失败或越界)。
    #[error("{0}")]
    Invalid(String),
}

/// 主题模式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
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

/// 界面语言。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    /// 简体中文(默认,P0)。
    #[default]
    Zh,
    /// 英文(M4)。
    En,
}

/// 光标样式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
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

/// 终端编码(与连接配置的编码枚举取值一致:'utf-8' / 'gbk')。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum TerminalEncoding {
    /// UTF-8(默认)。
    #[serde(rename = "utf-8")]
    #[default]
    Utf8,
    /// GBK。
    #[serde(rename = "gbk")]
    Gbk,
}

/// 终端配色方案(PRD 用户故事 19;GitHub Light 为默认)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
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

/// 默认认证方式(取值与连接契约一致)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
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

/// 传输冲突默认策略(取值与传输契约一致)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
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

/// 外观设置。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppearanceSettings {
    /// 主题。
    pub theme: ThemeMode,
    /// 语言。
    pub language: Language,
}

/// 终端默认设置(PRD §6.7)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TerminalSettings {
    /// 字体族。
    pub font_family: String,
    /// 字号(px)。
    pub font_size: u8,
    /// 行距倍数。
    pub line_height: f32,
    /// 配色方案。
    pub color_scheme: TerminalColorScheme,
    /// 光标样式。
    pub cursor_style: CursorStyle,
    /// 默认编码。
    pub encoding: TerminalEncoding,
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConnectionSettings {
    /// keepalive 间隔(秒),0 = 关闭。
    pub keepalive_interval_secs: u32,
    /// 默认认证方式。
    pub default_auth_method: DefaultAuthMethod,
}

/// 传输默认设置。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MonitorSettings {
    /// 默认采样间隔(秒)。
    pub default_interval_secs: u32,
}

/// 应用设置全集(PRD §6.7 分组);默认值 = 各分组默认值的组合。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
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
            encoding: TerminalEncoding::Utf8,
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

impl AppSettings {
    /// 校验数值边界;越界返回 [`SettingsError::Invalid`]。
    pub fn validate(&self) -> Result<(), SettingsError> {
        let t = &self.terminal;
        if !(8..=32).contains(&t.font_size) {
            return Err(SettingsError::Invalid("字号必须在 8–32 之间".into()));
        }
        if !(1.0..=2.0).contains(&t.line_height) {
            return Err(SettingsError::Invalid("行距必须在 1.0–2.0 之间".into()));
        }
        if !(100..=MAX_SCROLLBACK).contains(&t.scrollback) {
            return Err(SettingsError::Invalid(
                "回滚缓冲必须在 100–100000 行之间".into(),
            ));
        }
        if self.connection.keepalive_interval_secs > 600 {
            return Err(SettingsError::Invalid(
                "keepalive 间隔不能超过 600 秒".into(),
            ));
        }
        let xfer = &self.transfer;
        if !(1..=8).contains(&xfer.max_concurrent_tasks) {
            return Err(SettingsError::Invalid("并发任务数必须在 1–8 之间".into()));
        }
        if !(4..=1024).contains(&xfer.chunk_size_kib) {
            return Err(SettingsError::Invalid(
                "分块大小必须在 4–1024 KiB 之间".into(),
            ));
        }
        if !(2..=60).contains(&self.monitor.default_interval_secs) {
            return Err(SettingsError::Invalid("采样间隔必须在 2–60 秒之间".into()));
        }
        Ok(())
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
            .map_err(|e| SettingsError::Invalid(format!("设置文件损坏: {e}")))?;
        settings.validate()?;
        Ok(settings)
    }

    /// 以 JSON 对象补丁部分更新设置;返回更新后的全量设置。
    pub fn update(&self, patch: serde_json::Value) -> Result<AppSettings, SettingsError> {
        if !patch.is_object() {
            return Err(SettingsError::Invalid("设置补丁必须是对象".into()));
        }
        let current =
            serde_json::to_value(self.get()?).map_err(|e| SettingsError::Invalid(e.to_string()))?;
        let merged = merge_objects(current, patch);
        let settings: AppSettings = serde_json::from_value(merged)
            .map_err(|e| SettingsError::Invalid(format!("设置字段非法: {e}")))?;
        settings.validate()?;
        let raw =
            serde_json::to_string(&settings).map_err(|e| SettingsError::Invalid(e.to_string()))?;
        self.store.save_settings(&raw)?;
        Ok(settings)
    }

    /// 读取布局(前端表示层状态;未保存时返回空对象)。
    pub fn layout(&self) -> Result<serde_json::Value, SettingsError> {
        let Some(raw) = self.store.load_layout()? else {
            return Ok(serde_json::json!({}));
        };
        serde_json::from_str(&raw).map_err(|e| SettingsError::Invalid(format!("布局文件损坏: {e}")))
    }

    /// 保存布局;仅接受对象形态并限制体积。
    pub fn save_layout(&self, layout: serde_json::Value) -> Result<(), SettingsError> {
        if !layout.is_object() {
            return Err(SettingsError::Invalid("布局必须是对象".into()));
        }
        let raw =
            serde_json::to_string(&layout).map_err(|e| SettingsError::Invalid(e.to_string()))?;
        if raw.len() > MAX_LAYOUT_BYTES {
            return Err(SettingsError::Invalid("布局数据过大".into()));
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
