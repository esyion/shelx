//! 应用层端口:外部依赖抽象(AGENTS.md §4.3)。
//!
//! trait 由 application 声明、infrastructure 实现;
//! 应用层测试以内存 fake 替换实现,不触碰真实数据库。

use crate::domain::connection::{ConnConfig, ConnId, GroupId};
use crate::domain::group::Group;
use crate::domain::hostkey::HostKeyRecord;

/// 连接/分组持久化端口。
pub trait ConnectionStore: Send + Sync {
    /// 读取全部分组(顺序不限,排序由应用层统一完成)。
    fn groups(&self) -> Result<Vec<Group>, StoreError>;
    /// 读取全部连接。
    fn connections(&self) -> Result<Vec<ConnConfig>, StoreError>;
    /// 按 ID 读取单条连接。
    fn connection(&self, id: &ConnId) -> Result<Option<ConnConfig>, StoreError>;
    /// 按 ID 读取单个分组。
    fn group(&self, id: &GroupId) -> Result<Option<Group>, StoreError>;
    /// 新增分组。
    fn insert_group(&self, group: &Group) -> Result<(), StoreError>;
    /// 更新分组(整体替换,按 id 匹配)。
    fn update_group(&self, group: &Group) -> Result<(), StoreError>;
    /// 删除分组;子项处理策略由应用层先行校验/搬移。
    fn delete_group(&self, id: &GroupId) -> Result<(), StoreError>;
    /// 新增连接。
    fn insert_connection(&self, config: &ConnConfig) -> Result<(), StoreError>;
    /// 更新连接(整体替换,按 id 匹配)。
    fn update_connection(&self, config: &ConnConfig) -> Result<(), StoreError>;
    /// 删除连接。
    fn delete_connection(&self, id: &ConnId) -> Result<(), StoreError>;
}

/// 持久化层错误;由基础设施实现填充脱敏消息。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("数据库错误: {0}")]
pub struct StoreError(pub String);

/// 凭据保存方式(PRD §6.2 密码字段:钥匙串 / 只存本次会话 / 不存)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretSaveMode {
    /// 写入持久凭据存储(系统钥匙串,不可用时降级加密文件)。
    Keyring,
    /// 仅存进程内存,应用退出即失;不落库、不落盘。
    Session,
    /// 不保存;清除已存的旧凭据。
    Never,
}

/// 凭据存储可用性(供设置页展示"系统钥匙串 / 降级加密",PRD §6.2)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretAvailability {
    /// 系统钥匙串可用。
    Keyring,
    /// 钥匙串不可用,已降级为机器指纹派生密钥加密存储。
    Degraded,
}

/// 凭据存取端口;key 为引用键(如 `conn:<id>:password`),secret 为明文,
/// 加密与落盘细节由实现负责。
pub trait SecretStore: Send + Sync {
    /// 写入(存在则覆盖)。
    fn put(&self, key: &str, secret: &str) -> Result<(), SecretStoreError>;
    /// 读取;不存在返回 `None`。
    fn get(&self, key: &str) -> Result<Option<String>, SecretStoreError>;
    /// 删除;不存在视为成功(幂等)。
    fn delete(&self, key: &str) -> Result<(), SecretStoreError>;
}

/// 凭据存储错误;消息已脱敏,不得包含凭据本体。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("凭据存储错误: {0}")]
pub struct SecretStoreError(pub String);

/// 设置与布局持久化端口;以原始 JSON 字符串交换,
/// 解析、校验与合并语义由应用层统一实现。
pub trait SettingsStore: Send + Sync {
    /// 读取设置原始 JSON;从未保存过返回 `None`。
    fn load_settings(&self) -> Result<Option<String>, StoreError>;
    /// 原子写入设置 JSON。
    fn save_settings(&self, raw: &str) -> Result<(), StoreError>;
    /// 读取布局原始 JSON;从未保存过返回 `None`。
    fn load_layout(&self) -> Result<Option<String>, StoreError>;
    /// 原子写入布局 JSON。
    fn save_layout(&self, raw: &str) -> Result<(), StoreError>;
}

/// 主机指纹存取端口(TOFU,设计文档 §7.7-4)。
pub trait HostKeyStore: Send + Sync {
    /// 读取已确认的主机指纹。
    fn host_key(&self, host: &str, port: u16) -> Result<Option<HostKeyRecord>, StoreError>;
    /// 记录(或覆盖)主机指纹。
    fn save_host_key(
        &self,
        host: &str,
        port: u16,
        record: &HostKeyRecord,
    ) -> Result<(), StoreError>;
}

/// 键盘交互的单条 prompt 规格。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptSpec {
    /// 展示文案(如"请输入动态口令:")。
    pub prompt: String,
    /// 是否回显输入(密码型为 false)。
    pub echo: bool,
}

/// 键盘交互请求的事件载荷(设计文档 §6.4 `auth-prompt`)。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthPromptRequest {
    /// 请求 ID,应答命令凭此送达。
    pub request_id: String,
    /// 服务端给出的名称(如 "OTP Authentication")。
    pub name: String,
    /// 服务端给出的说明,可为空。
    pub instructions: Option<String>,
    /// 逐条 prompt。
    pub prompts: Vec<PromptSpec>,
}

/// 首次主机指纹确认请求的事件载荷(设计文档 §6.4 `hostkey-confirm`)。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyConfirmRequest {
    /// 请求 ID。
    pub request_id: String,
    /// 主机。
    pub host: String,
    /// 端口。
    pub port: u16,
    /// 公钥算法。
    pub algorithm: String,
    /// SHA256 指纹。
    pub fingerprint: String,
}

/// 会话事件出口:由 Tauri 适配层实现为前端事件(设计文档 §6.4)。
///
/// 应用层与 SSH 传输层只依赖本端口,不感知 Tauri 运行时。
pub trait SessionEventSink: Send + Sync {
    /// 键盘交互请求(OTP 等),等待 `respond_auth_prompt` 应答。
    fn auth_prompt(&self, request: &AuthPromptRequest);
    /// 首次主机指纹确认请求,等待 `respond_hostkey_confirm` 应答。
    fn hostkey_confirm(&self, request: &HostKeyConfirmRequest);
    /// 会话状态机变化(前端据此更新标签圆点、横幅与监控置灰)。
    fn status_changed(&self, event: &SessionStatusEvent);
}

/// SSH 传输层错误(应用视角,不含 russh 细节;
/// 基础设施实现负责把驱动错误映射到此)。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TransportError {
    /// TCP 连接、握手或协议层失败。
    #[error("连接失败:{0}")]
    Network(String),
    /// 认证被拒绝(凭据错误或方式不允许)。
    #[error("认证失败:服务器拒绝用户名或凭据(可尝试:{})", remaining.join(", "))]
    AuthRejected {
        /// 服务器提示仍可尝试的认证方式。
        remaining: Vec<String>,
    },
    /// 私钥加载失败(缺失/不可读/口令错误)。
    #[error("私钥加载失败:{0}")]
    Key(String),
    /// 主机指纹变化,阻断。
    #[error("主机指纹已变化,连接被阻断(疑似中间人攻击)")]
    HostkeyMismatch {
        /// 旧指纹。
        recorded: String,
        /// 新指纹。
        current: String,
    },
    /// 首次指纹未获确认(拒绝或超时)。
    #[error("主机指纹未获确认,连接取消")]
    HostkeyRejected,
    /// 键盘交互失败(取消/超时)。
    #[error("键盘交互失败:{0}")]
    Prompt(String),
    /// 指纹存取失败。
    #[error("{0}")]
    Storage(#[from] StoreError),
    /// 远端文件操作失败(服务端消息原文)。
    #[error("远端文件操作失败:{0}")]
    RemoteFs(String),
    /// 本地文件操作失败。
    #[error("本地文件操作失败:{0}")]
    LocalIo(String),
    /// 远端权限不足。
    #[error("远端权限不足:{0}")]
    RemotePermissionDenied(String),
}

/// 已认证 SSH 连接的端口;pty 通道供终端使用,
/// M3 监控复用 [`SshConnection::exec_once`]。
#[async_trait::async_trait]
pub trait SshConnection: Send + Sync {
    /// 请求优雅断开。
    async fn disconnect(&self) -> Result<(), TransportError>;
    /// 传输层是否已断开。
    fn is_closed(&self) -> bool;
    /// 执行一次性命令并收集标准输出(超时秒数),用于 serverInfo 与监控采集。
    async fn exec_once(
        &self,
        command: &str,
        timeout: std::time::Duration,
    ) -> Result<String, TransportError>;
    /// 开辟 pty 终端通道并启动输出泵;输出批量经 sink 推送
    /// (设计文档 §5.3.2:≤16ms 或 ≤64KiB 聚合)。
    async fn open_pty(
        &self,
        cols: u32,
        rows: u32,
        terminal_id: &str,
        sink: std::sync::Arc<dyn TerminalDataSink>,
    ) -> Result<Box<dyn PtyChannel>, TransportError>;
    /// 开辟 SFTP 子系统通道(懒初始化,由应用层缓存复用)。
    async fn open_sftp(&self) -> Result<Box<dyn SftpChannel>, TransportError>;
}

/// SSH 传输端口:建立连接并完成认证(host key TOFU 在内部经事件桥确认)。
#[async_trait::async_trait]
pub trait SshTransport: Send + Sync {
    /// 连接并认证。
    async fn connect(
        &self,
        params: &SshConnectParams,
    ) -> Result<Box<dyn SshConnection>, TransportError>;
}

/// 建连参数与认证计划(应用层形态;基础设施实现据此驱动 russh)。
#[derive(Clone)]
pub struct SshConnectParams {
    /// 主机(IP 或域名)。
    pub host: String,
    /// 端口。
    pub port: u16,
    /// 用户名。
    pub username: String,
    /// 认证计划。
    pub auth: AuthPlan,
}

/// 认证计划。
#[derive(Clone)]
pub enum AuthPlan {
    /// 账号密码。
    Password {
        /// 密码明文;仅在连接期间与内存中短暂持有。
        password: String,
    },
    /// 私钥;路径为空时尝试 `~/.ssh` 默认密钥。
    PrivateKey {
        /// 私钥路径。
        path: Option<std::path::PathBuf>,
        /// 私钥口令。
        passphrase: Option<String>,
    },
    /// 键盘交互(OTP),逐轮经事件桥收集。
    KeyboardInteractive,
    /// 免密:默认密钥与 ssh-agent 依次尝试。
    Agent,
}

/// 会话状态变化事件载荷(设计文档 §6.4 `session-status-changed`)。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatusEvent {
    /// 会话 ID。
    pub session_id: String,
    /// 来源连接 ID;快速连接的临时会话为空。
    pub conn_id: Option<String>,
    /// 新状态(connecting / online / disconnected)。
    pub status: String,
    /// 断开原因等补充说明。
    pub reason: Option<String>,
}

/// 终端数据出口:输出泵把 pty 字节流批量推到这里,
/// 基础设施实现为 ipc Channel 的原始字节发送(设计文档 §5.3.2)。
pub trait TerminalDataSink: Send + Sync {
    /// 推送一批终端输出字节(≤64KiB 或 ≤16ms 聚合)。
    fn on_data(&self, terminal_id: &str, bytes: Vec<u8>);
}

/// pty 终端通道端口(一个 xterm 实例对应一个)。
#[async_trait::async_trait]
pub trait PtyChannel: Send + Sync {
    /// 写入用户输入字节(前端已按连接编码完成转码)。
    async fn write(&self, data: Vec<u8>) -> Result<(), TransportError>;
    /// 通知远端窗口尺寸变化(pty window_change)。
    async fn resize(&self, cols: u32, rows: u32) -> Result<(), TransportError>;
    /// 关闭通道。
    async fn close(&self) -> Result<(), TransportError>;
}

/// 远端文件类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteFileType {
    /// 目录。
    Dir,
    /// 常规文件。
    File,
    /// 符号链接(删除时不跟随)。
    Symlink,
    /// 其他(套接字/FIFO/设备等)。
    Other,
}

/// 远端文件条目(列表与删除判型共用)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteEntry {
    /// 文件名(不含路径)。
    pub name: String,
    /// 类型。
    pub file_type: RemoteFileType,
    /// 字节数;目录为 0。
    pub size: u64,
    /// 修改时间(unix 秒)。
    pub mtime: Option<u64>,
    /// 权限位(如 0o755)。
    pub mode: Option<u32>,
    /// 属主(协议返回时存在)。
    pub owner: Option<String>,
}

/// SFTP 通道端口(同一 SSH 会话懒开、复用;传输引擎随 M2-B3 扩展读写)。
#[async_trait::async_trait]
pub trait SftpChannel: Send + Sync {
    /// 远端主目录(连接后定位初始路径)。
    async fn home_path(&self) -> Result<String, TransportError>;
    /// 列出目录条目(`.`/`..` 已滤除)。
    async fn entries(&self, path: &str) -> Result<Vec<RemoteEntry>, TransportError>;
    /// 单条目的类型与属性(删除判型;符号链接不跟随)。
    async fn entry(&self, path: &str) -> Result<RemoteEntry, TransportError>;
    /// 创建目录(父目录必须已存在)。
    async fn mkdir(&self, path: &str) -> Result<(), TransportError>;
    /// 重命名/移动(old、new 均为完整路径)。
    async fn rename(&self, old_path: &str, new_path: &str) -> Result<(), TransportError>;
    /// 删除常规文件或符号链接。
    async fn remove_file(&self, path: &str) -> Result<(), TransportError>;
    /// 删除空目录。
    async fn remove_dir(&self, path: &str) -> Result<(), TransportError>;
    /// 修改权限位(chmod)。
    async fn set_permissions(&self, path: &str, mode: u32) -> Result<(), TransportError>;
    /// 打开远端文件写流(创建/截断;传输引擎写入 .shelx-partial 临时名)。
    async fn open_write_stream(
        &self,
        path: &str,
    ) -> Result<Box<dyn TransferStream>, TransportError>;
    /// 打开远端文件读流。
    async fn open_read_stream(&self, path: &str)
        -> Result<Box<dyn TransferStream>, TransportError>;
    /// 远端文件大小;不存在返回 None(冲突预检/下载总量)。
    async fn file_size(&self, path: &str) -> Result<Option<u64>, TransportError>;
}

/// 传输方向。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferDirection {
    /// 上传(本地 → 远端)。
    Upload,
    /// 下载(远端 → 本地)。
    Download,
}

/// 传输流端口(M2-B3):按顺序块抽象;russh-sftp 的 File 内部
/// 以并发确认窗口流水线化(设计文档 §7.7-3 的两层并发之上游)。
#[async_trait::async_trait]
pub trait TransferStream: Send + Sync {
    /// 追加写入一块(从当前末尾顺序)。
    async fn append_chunk(&self, data: &[u8]) -> Result<(), TransportError>;
    /// 读取一块到 buf,返回读取字节数(0 = EOF)。
    async fn read_chunk(&self, buf: &mut Vec<u8>, max: usize) -> Result<usize, TransportError>;
    /// 确认全部写入落盘(sync)。
    async fn finish(&self) -> Result<(), TransportError>;
}

/// 传输进度事件载荷(200ms 节流推送,设计文档 §6.3)。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgressEvent {
    /// 任务 ID。
    pub task_id: String,
    /// 目录组 ID(单文件为 null)。
    pub group_id: Option<String>,
    /// 状态(queued/preparing/awaiting_conflict/transferring/completed/failed/cancelled)。
    pub status: String,
    /// 已传输字节。
    pub transferred_bytes: u64,
    /// 总字节。
    pub total_bytes: u64,
    /// 平均速度(字节/秒)。
    pub speed_bps: Option<u64>,
    /// 失败原因。
    pub error: Option<String>,
}

/// 传输进度出口;Tauri 适配层实现为 ipc Channel JSON 推送。
pub trait TransferProgressSink: Send + Sync {
    /// 推送一次进度/状态。
    fn on_progress(&self, event: &TransferProgressEvent);
}

/// 本地文件随机句柄(传输引擎用;同步语义,本地磁盘微秒级)。
pub trait LocalFile: Send {
    /// 顺序读一块到 buf,返回字节数(0 = EOF)。
    fn read_chunk(&mut self, buf: &mut Vec<u8>, max: usize) -> Result<(), String>;
    /// 顺序追加写一块。
    fn write_chunk(&mut self, data: &[u8]) -> Result<(), String>;
    /// 落盘。
    fn finish(&mut self) -> Result<(), String>;
}

/// 本地文件系统端口(上传读/下载写/目录遍历;AGENTS.md §4.5 I/O 在 infra)。
pub trait LocalFs: Send + Sync {
    /// 文件大小;不存在返回 None。
    fn file_size(&self, path: &str) -> Result<Option<u64>, String>;
    /// 是否目录。
    fn is_dir(&self, path: &str) -> Result<bool, String>;
    /// 列出直接子项 (名称, 是否目录)。
    fn list_dir(&self, path: &str) -> Result<Vec<(String, bool)>, String>;
    /// 递归确保目录存在。
    fn ensure_dir(&self, path: &str) -> Result<(), String>;
    /// 打开只读句柄。
    fn open_read(&self, path: &str) -> Result<Box<dyn LocalFile>, String>;
    /// 创建/截断写句柄。
    fn create_write(&self, path: &str) -> Result<Box<dyn LocalFile>, String>;
    /// 重命名。
    fn rename(&self, old_path: &str, new_path: &str) -> Result<(), String>;
    /// 删除文件。
    fn remove_file(&self, path: &str) -> Result<(), String>;
}
