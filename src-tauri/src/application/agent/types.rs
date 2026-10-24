//! Agent 应用层数据类型与端口定义(AGENTS.md §4.3)。
//!
//! 端口:
//! - [`AgentStore`]:线程、消息、运行、工具审计、profile、记忆的持久化(实现见 infrastructure/sqlite);
//! - [`LlmGateway`]:"跑一轮 Agent"这一外部能力(实现见 infrastructure/agent/rig_bridge);
//! - [`ToolHost`](tools::ToolHost):工具落地到 SSH(实现见 [`tool_host`]).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::application::agent::events::AgentUsage;
pub use crate::domain::agent::{
    AgentMemory, ApprovalDecision, ApprovalMode, ModelProfile, ProtocolKind, RunState, ThreadId,
    ToolCallRecord,
};

/// 消息角色。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    /// 用户输入。
    User,
    /// 模型回答。
    Assistant,
    /// 工具调用与结果(审计与展开查看用)。
    Tool,
    /// 系统事件文本(取消、失败、批准结果)。
    System,
}

impl MessageRole {
    /// 稳定字面量。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::Tool => "tool",
            Self::System => "system",
        }
    }
}

/// 一条已落库的消息。
#[derive(Debug, Clone)]
pub struct MessageRecord {
    /// 消息 ID。
    pub id: String,
    /// 所属线程。
    pub thread_id: String,
    /// 角色。
    pub role: MessageRole,
    /// 正文(工具消息为结果 JSON 摘要)。
    pub content: String,
    /// 创建时间(unix 毫秒)。
    pub created_at: i64,
}

/// 一个对话线程。
#[derive(Debug, Clone)]
pub struct ThreadRecord {
    /// 线程 ID。
    pub id: String,
    /// 标题(可由模型归纳)。
    pub title: String,
    /// 使用的模型 profile。
    pub profile_id: String,
    /// 审批模式。
    pub approval: ApprovalMode,
    /// 用户手动绑定的会话(上下文来源;`None` 表示不绑定)。
    pub bound_session_id: Option<String>,
    /// 创建时间。
    pub created_at: i64,
    /// 更新时间。
    pub updated_at: i64,
    /// 归档时间(`None` 表示未归档)。
    pub archived_at: Option<i64>,
    /// 置顶时间(`None` 表示未置顶;列表里置顶在前、按置顶时间倒序)。
    pub pinned_at: Option<i64>,
}

/// 一次运行的持久化记录(重启后据此解释"上次为什么没跑完")。
#[derive(Debug, Clone)]
pub struct RunRecord {
    /// 运行 ID。
    pub run_id: String,
    /// 所属线程。
    pub thread_id: String,
    /// 状态。
    pub state: RunState,
    /// 用户这一轮的输入。
    pub prompt: String,
    /// 最终回答。
    pub final_text: String,
    /// 失败原因。
    pub error: Option<String>,
    /// 用量。
    pub usage: Option<AgentUsage>,
    /// 工具轮次数。
    pub turns: i64,
    /// 创建时间。
    pub created_at: i64,
    /// 更新时间。
    pub updated_at: i64,
    /// 这一轮已发布的事件(思考增量、工具步、回答增量…按 seq 正序)。
    ///
    /// 界面的时间线只从这份日志归并出来:它是"这一轮做了什么"的唯一耐久真源,
    /// 因此不再需要判断"回答该由历史消息还是由流式缓冲呈现"(AGENTS.md §5)。
    pub timeline: Vec<crate::application::agent::events::AgentEvent>,
}

/// 一条工具审计记录(界面"展开查看"与事后追溯的数据源)。
pub type AuditRecord = ToolCallRecord;

/// 批准决策落库形态。
#[derive(Debug, Clone)]
pub struct ApprovalRecord {
    /// 请求 ID。
    pub request_id: String,
    /// 线程。
    pub thread_id: String,
    /// 运行。
    pub run_id: String,
    /// 工具名。
    pub tool_name: String,
    /// 目标主机。
    pub conn_id: String,
    /// 决策。
    pub decision: ApprovalDecision,
    /// 决策时间。
    pub decided_at: i64,
}

/// 模型 profile 的持久化形态(密钥只存引用键,AGENTS.md §7)。
#[derive(Debug, Clone)]
pub struct ProfileRecord {
    /// 配置 ID。
    pub id: String,
    /// 显示名。
    pub label: String,
    /// 协议。
    pub protocol: ProtocolKind,
    /// 模型名。
    pub model: String,
    /// 自定义端点。
    pub base_url: Option<String>,
    /// 是否已确认支持要求的协议。
    pub responses_verified: bool,
    /// 密钥引用键(`llm:<id>:api_key`)。
    pub secret_ref: String,
    /// 是否启用。
    pub enabled: bool,
    /// 创建时间。
    pub created_at: i64,
    /// 上下文窗口覆盖(tokens);`None` = 用模型目录里的值。
    pub context_window: Option<u32>,
    /// 单次回复上限覆盖(tokens);`None` = 用模型目录里的值。
    pub max_output_tokens: Option<u32>,
}

impl ProfileRecord {
    /// 映射为领域对象;领域校验在此生效(非法配置读不出来也用不了)。
    ///
    /// # Errors
    /// 见 [`ModelProfile::new`]。
    pub fn to_domain(&self) -> Result<ModelProfile, crate::domain::agent::AgentDomainError> {
        ModelProfile::new(
            crate::domain::agent::ProfileId::new(self.id.clone())?,
            self.label.clone(),
            self.protocol,
            self.model.clone(),
            self.base_url.clone(),
            self.responses_verified,
        )?
        .with_limits(self.context_window, self.max_output_tokens)
    }
}

/// 保存模型配置的用例入参(接口层校验后传入)。
#[derive(Debug, Clone)]
pub struct ProfileDraft {
    /// 已有配置 ID;`None` 表示新建。
    pub id: Option<String>,
    /// 显示名。
    pub label: String,
    /// 协议。
    pub protocol: crate::domain::agent::ProtocolKind,
    /// 模型名。
    pub model: String,
    /// 自定义端点。
    pub base_url: Option<String>,
    /// 是否已确认支持要求的协议。
    pub responses_verified: bool,
    /// 密钥明文;`None` 表示保留既有。仅在本用例内短暂存在,禁止落日志。
    pub api_key: Option<String>,
    /// 是否启用。
    pub enabled: bool,
    /// 上下文窗口覆盖(tokens);`None` = 用模型目录里的值。
    pub context_window: Option<u32>,
    /// 单次回复上限覆盖(tokens);`None` = 用模型目录里的值。
    pub max_output_tokens: Option<u32>,
}

/// 新建线程的入参(应用层用例形态,DTO 校验在接口层完成)。
#[derive(Debug, Clone)]
pub struct NewThread {
    /// 标题;为空时由应用层给默认标题。
    pub title: String,
    /// profile ID。
    pub profile_id: String,
    /// 审批模式。
    pub approval: ApprovalMode,
    /// 绑定会话。
    pub bound_session_id: Option<String>,
}

/// 发起一轮的入参。
#[derive(Debug, Clone)]
pub struct SendRequest {
    /// 线程 ID。
    pub thread_id: ThreadId,
    /// 用户输入。
    pub prompt: String,
    /// 本轮绑定的会话(可选,覆盖线程默认值)。
    pub bound_session_id: Option<String>,
}

/// 联网搜索密钥在凭据存储里的引用键(与 `llm:<id>:api_key` 同一存储,AGENTS.md §7)。
pub const WEB_SEARCH_SECRET_REF: &str = "tavily:api_key";

/// 一条联网搜索命中(与具体搜索服务商无关的形态;只进模型载荷,不进 IPC 契约)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchHit {
    /// 结果标题。
    pub title: String,
    /// 来源链接。
    pub url: String,
    /// 内容摘要。
    pub content: String,
}

/// 联网搜索端口:查询公网最新信息(实现见 infrastructure/agent/web_search)。
#[async_trait::async_trait]
pub trait WebSearch: Send + Sync {
    /// 执行一次搜索;`api_key` 由调用方从凭据存储取出传入,禁止落日志。
    /// `query` 非空、`max_results` 在 1..=10 由调用方保证。
    ///
    /// # Errors
    /// 网络、凭据或额度问题,消息已脱敏(不含密钥)。
    async fn search(
        &self,
        api_key: &str,
        query: &str,
        max_results: u8,
    ) -> Result<Vec<WebSearchHit>, WebSearchFault>;
}

/// 搜索端口错误(消息已脱敏,不含密钥)。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct WebSearchFault(pub String);

/// 运行上下文:一次运行期间工具执行需要的环境。
#[derive(Debug, Clone)]
pub struct RunContext {
    /// 线程 ID。
    pub thread_id: String,
    /// 运行 ID。
    pub run_id: String,
    /// 审批模式。
    pub approval: ApprovalMode,
    /// 用户绑定的会话(`None` 时工具自行按 connId 建连)。
    pub bound_conn_id: Option<String>,
    /// 单次批量主机上限。
    pub batch_limit: usize,
    /// 同时执行的主机数上限。
    pub parallel_hosts: usize,
    /// 单条命令超时秒数。
    pub exec_timeout_secs: u64,
    /// 联网搜索是否注册(`web_search` 工具只在密钥已配置的本轮出现)。
    pub web_search_enabled: bool,
    /// 取消令牌。
    pub cancel: super::hub::CancelToken,
}

/// 一轮运行的产出。
#[derive(Debug, Clone)]
pub struct RunOutcome {
    /// 终态。
    pub state: RunState,
    /// 最终回答文本。
    pub final_text: String,
    /// 累计用量。
    pub usage: AgentUsage,
    /// 工具轮次。
    pub turns: usize,
    /// 失败原因(暂停时为暂停说明)。
    pub error: Option<String>,
    /// 模型归纳出的标题(首轮时)。
    pub title: Option<String>,
    /// 断点上下文(仅暂停时):网关序列化的对话历史,继续时原样传回。
    /// 应用层不解析内容,只负责与运行记录一起持久化。
    pub resume_history: Option<String>,
}

/// 跑一轮所需的全部输入(由应用层组装,gateway 只消费)。
#[derive(Debug, Clone)]
pub struct RunPlan {
    /// 模型配置。
    pub profile: ModelProfile,
    /// API 密钥(仅在本次调用内存在,禁止落日志与 IPC)。
    pub api_key: String,
    /// 用户输入。
    pub prompt: String,
    /// 系统提示(角色、边界、当前主机清单、已启用的共享记忆)。
    pub preamble: String,
    /// 最大工具轮次。
    pub max_turns: usize,
    /// 携带的历史消息条数(上下文窗口档位)。
    pub context_messages: usize,
    /// 断点上下文(继续暂停的一轮时):网关格式的对话历史序列化,
    /// 优先于 `context_messages` 的常规装配。
    pub resume_history: Option<String>,
}

/// Agent 持久化端口。
pub trait AgentStore: Send + Sync {
    /// 线程列表(未归档,按更新时间倒序)。
    fn threads(&self) -> Result<Vec<ThreadRecord>, StoreFault>;
    /// 读取单线程。
    fn thread(&self, id: &str) -> Result<Option<ThreadRecord>, StoreFault>;
    /// 写入线程(存在即整体替换)。
    fn upsert_thread(&self, thread: &ThreadRecord) -> Result<(), StoreFault>;
    /// 删除线程(级联删除消息、运行、审计)。
    fn delete_thread(&self, id: &str) -> Result<(), StoreFault>;
    /// 追加消息。
    fn append_message(&self, message: &MessageRecord) -> Result<(), StoreFault>;
    /// 读取线程消息(按 seq 正序,最多 limit 条尾部)。
    fn messages(&self, thread_id: &str, limit: usize) -> Result<Vec<MessageRecord>, StoreFault>;
    /// 写入/更新运行记录。
    fn upsert_run(&self, run: &RunRecord) -> Result<(), StoreFault>;
    /// 线程的运行历史。
    fn runs(&self, thread_id: &str) -> Result<Vec<RunRecord>, StoreFault>;
    /// 把某线程仍未结束的运行标记为指定状态(启动清理用)。
    fn expire_unfinished_runs(&self) -> Result<usize, StoreFault>;
    /// 写入工具审计记录(每台主机一行)。
    fn insert_tool_call(&self, record: &AuditRecord) -> Result<(), StoreFault>;
    /// 线程的工具审计。
    fn tool_calls(&self, thread_id: &str) -> Result<Vec<AuditRecord>, StoreFault>;
    /// 记录一次批准决策。
    fn record_approval(&self, record: &ApprovalRecord) -> Result<(), StoreFault>;
    /// 记忆列表。
    fn memories(&self) -> Result<Vec<AgentMemory>, StoreFault>;
    /// 写入记忆。
    fn upsert_memory(&self, memory: &AgentMemory) -> Result<(), StoreFault>;
    /// 删除记忆。
    fn delete_memory(&self, id: &str) -> Result<(), StoreFault>;
    /// profile 列表。
    fn profiles(&self) -> Result<Vec<ProfileRecord>, StoreFault>;
    /// 写入 profile。
    fn upsert_profile(&self, profile: &ProfileRecord) -> Result<(), StoreFault>;
    /// 删除 profile。
    fn delete_profile(&self, id: &str) -> Result<(), StoreFault>;
    /// 写入命名空间下的对象(对话日志与消息附件共用一张表,按 `space` 隔离)。
    fn store_put(&self, space: &str, name: &str, bytes: &[u8]) -> Result<(), StoreFault>;
    /// 读取命名空间下的对象;不存在返回 `None`。
    fn store_get(&self, space: &str, name: &str) -> Result<Option<Vec<u8>>, StoreFault>;
    /// 条件写入:当前长度必须为 `len`;不匹配返回 `true`(表示被并发改动,未写入)。
    ///
    /// `append` 为真时追加,否则整体替换。`len` 为 0 表示期望"尚不存在"。
    fn store_conditional(
        &self,
        space: &str,
        name: &str,
        len: i64,
        bytes: &[u8],
        append: bool,
    ) -> Result<bool, StoreFault>;
    /// 列出命名空间下某一类对象名(`"file"` 或 `"log"`)。
    fn store_list(&self, space: &str, kind: &str) -> Result<Vec<String>, StoreFault>;
    /// 删除命名空间下的单个对象(不存在视为成功)。
    fn store_remove(&self, space: &str, name: &str) -> Result<(), StoreFault>;
    /// 清空命名空间(会话彻底结束时用)。
    fn store_clear(&self, space: &str) -> Result<(), StoreFault>;
}

/// 持久化端口错误(消息已脱敏)。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("Agent 存储错误:{0}")]
pub struct StoreFault(pub String);

/// 网关执行错误。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GatewayFault {
    /// 模型构造失败。
    #[error("{0}")]
    Provider(String),
    /// 存储失败。
    #[error("{0}")]
    Store(#[from] StoreFault),
}

/// LLM 网关端口:一次完整的"模型 + 工具循环"。
#[async_trait::async_trait]
pub trait LlmGateway: Send + Sync {
    /// 执行一轮;事件经 hub 广播,工具经 host 落地,批准经 approvals 等待。
    ///
    /// 实现必须自行保证:任何异常路径都以终态收尾并广播 `run_failed` 或 `run_cancelled`。
    async fn execute(
        &self,
        plan: std::sync::Arc<RunPlan>,
        context: std::sync::Arc<RunContext>,
        host: std::sync::Arc<dyn super::tools::ToolHost>,
        hub: std::sync::Arc<super::hub::ThreadEventHub>,
        approvals: std::sync::Arc<super::hub::ApprovalCenter>,
    ) -> RunOutcome;
}

/// 记忆注入形态(领域对象 → 进模型的字符串)。
pub fn memory_line(memory: &AgentMemory) -> String {
    let scope = match memory.scope {
        crate::domain::agent::MemoryScope::Global => "全局",
        crate::domain::agent::MemoryScope::Connection => "主机",
    };
    format!("[{scope}] {}", memory.content)
}
