//! Agent IPC DTO:跨边界的稳定数据形状(AGENTS.md §5)。
//!
//! 字段 camelCase;ID 一律 string;枚举取值来自领域层(后端单点定义)。
//! 事件与用量结构直接复用应用层导出(`AgentEvent`/`AgentUsage`),与
//! `TransferProgressEvent` 同一先例,避免两处定义漂移。

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::application::agent::events::{AgentEvent, AgentUsage};
use crate::application::agent::types::{
    MessageRecord, MessageRole, ProfileRecord, RunRecord, ThreadRecord,
};
use crate::application::agent::{PendingApprovalView, ResolvedTarget, TargetView};
use crate::domain::agent::{
    AgentMemory, ApprovalDecision, ApprovalMode, MemoryScope, ProtocolKind, RunState, TargetStatus,
    ToolCallRecord, ToolCategory,
};

/// 时间戳(unix 毫秒,跨边界统一 number 仅用于时间而非 ID)。
pub type Millis = i64;

/// 线程。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ThreadDto {
    /// ID。
    pub id: String,
    /// 标题。
    pub title: String,
    /// 模型配置 ID。
    pub profile_id: String,
    /// 审批档位。
    pub approval_mode: ApprovalMode,
    /// 手动绑定的会话 ID。
    pub bound_session_id: Option<String>,
    /// 创建时间。
    pub created_at: Millis,
    /// 更新时间。
    pub updated_at: Millis,
}

impl From<ThreadRecord> for ThreadDto {
    /// 领域记录 → DTO。
    fn from(value: ThreadRecord) -> Self {
        Self {
            id: value.id,
            title: value.title,
            profile_id: value.profile_id,
            approval_mode: value.approval,
            bound_session_id: value.bound_session_id,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

/// 一条消息。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MessageDto {
    /// ID。
    pub id: String,
    /// 角色。
    pub role: MessageRole,
    /// 正文。
    pub content: String,
    /// 创建时间。
    pub created_at: Millis,
}

impl From<MessageRecord> for MessageDto {
    /// 领域记录 → DTO。
    fn from(value: MessageRecord) -> Self {
        Self {
            id: value.id,
            role: value.role,
            content: value.content,
            created_at: value.created_at,
        }
    }
}

/// 一轮运行。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RunDto {
    /// 运行 ID。
    pub run_id: String,
    /// 状态。
    pub state: RunState,
    /// 提问。
    pub prompt: String,
    /// 最终回答。
    pub final_text: String,
    /// 失败原因。
    pub error: Option<String>,
    /// 用量。
    pub usage: Option<AgentUsage>,
    /// 工具轮次。
    pub turns: i64,
    /// 开始时间。
    pub created_at: Millis,
    /// 这一轮的过程日志(已发布事件,按 seq 正序;界面时间线的唯一来源)。
    pub timeline: Vec<AgentEvent>,
}

impl From<RunRecord> for RunDto {
    /// 领域记录 → DTO。
    fn from(value: RunRecord) -> Self {
        Self {
            run_id: value.run_id,
            state: value.state,
            prompt: value.prompt,
            final_text: value.final_text,
            error: value.error,
            usage: value.usage,
            turns: value.turns,
            created_at: value.created_at,
            timeline: value.timeline,
        }
    }
}

/// 工具审计行。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuditDto {
    /// ID。
    pub id: String,
    /// 运行 ID。
    pub run_id: String,
    /// 工具名。
    pub tool_name: String,
    /// 类别。
    pub category: ToolCategory,
    /// 目标主机。
    pub conn_id: Option<String>,
    /// 入参原文。
    pub args_json: String,
    /// 状态。
    pub status: TargetStatus,
    /// 批准决策;按档位自动放行的只读操作为 null(没有人批准过)。
    pub approval: Option<ApprovalDecision>,
    /// 输出摘要(截断后);未执行或无输出为 null。
    pub output_excerpt: Option<String>,
    /// 该台主机上的执行耗时(毫秒);未开始执行(拒绝/取消)为 null。
    pub duration_ms: Option<i64>,
}

impl From<ToolCallRecord> for AuditDto {
    /// 领域记录 → DTO。
    fn from(value: ToolCallRecord) -> Self {
        Self {
            id: value.id.as_str().to_owned(),
            run_id: value.run_id.as_str().to_owned(),
            tool_name: value.tool_name,
            category: value.category,
            conn_id: value.conn_id,
            args_json: value.args_json,
            status: value.status,
            approval: value.approval,
            output_excerpt: value.output_excerpt,
            duration_ms: value.duration_ms,
        }
    }
}

/// 待批准请求(死状态必须持续可见)。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDto {
    /// 请求 ID。
    pub request_id: String,
    /// 所属线程(跨对话提醒需要它)。
    pub thread_id: String,
    /// 运行 ID。
    pub run_id: String,
    /// 工具名。
    pub tool_name: String,
    /// 类别。
    pub category: ToolCategory,
    /// 入参原文。
    pub args_json: String,
    /// 为什么要批准。
    pub reason: String,
    /// 涉及主机。
    pub targets: Vec<TargetDto>,
}

impl From<PendingApprovalView> for ApprovalDto {
    /// 应用层视图 → DTO。
    fn from(value: PendingApprovalView) -> Self {
        Self {
            request_id: value.request_id,
            thread_id: value.thread_id,
            run_id: value.run_id,
            tool_name: value.tool_name,
            category: value.category,
            args_json: value.args_json,
            reason: value.reason,
            targets: value.targets.into_iter().map(TargetDto::from).collect(),
        }
    }
}

/// 一台主机。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TargetDto {
    /// 连接 ID。
    pub conn_id: String,
    /// 显示名。
    pub conn_name: String,
    /// 地址。
    pub host: Option<String>,
    /// 端口。
    pub port: Option<u16>,
    /// 是否在线。
    pub online: Option<bool>,
}

impl From<TargetView> for TargetDto {
    /// 批准弹窗用的最小主机视图。
    fn from(value: TargetView) -> Self {
        Self {
            conn_id: value.conn_id,
            conn_name: value.conn_name,
            host: None,
            port: None,
            online: None,
        }
    }
}

impl From<ResolvedTarget> for TargetDto {
    /// 作用域解析结果 → DTO。
    fn from(value: ResolvedTarget) -> Self {
        Self {
            conn_id: value.id,
            conn_name: value.name,
            host: Some(value.host),
            port: Some(value.port),
            online: Some(value.online),
        }
    }
}

/// 线程快照。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSnapshotDto {
    /// 线程。
    pub thread: ThreadDto,
    /// 消息。
    pub messages: Vec<MessageDto>,
    /// 运行历史。
    pub runs: Vec<RunDto>,
    /// 待批准。
    pub pending: Vec<ApprovalDto>,
    /// 仍在进行的运行 ID。
    pub running: Vec<String>,
    /// 当前事件序号(订阅续接用)。
    pub latest_seq: i64,
}

impl From<crate::application::agent::ThreadSnapshot> for ThreadSnapshotDto {
    /// 应用层快照 → DTO。
    fn from(value: crate::application::agent::ThreadSnapshot) -> Self {
        Self {
            thread: value.thread.into(),
            messages: value.messages.into_iter().map(MessageDto::from).collect(),
            runs: value.runs.into_iter().map(RunDto::from).collect(),
            pending: value.pending.into_iter().map(ApprovalDto::from).collect(),
            running: value.running,
            latest_seq: value.latest_seq,
        }
    }
}

/// 模型配置(不含密钥,只说明有没有)。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDto {
    /// ID。
    pub id: String,
    /// 名称。
    pub label: String,
    /// 协议。
    pub protocol: ProtocolKind,
    /// 模型名。
    pub model: String,
    /// 自定义端点。
    pub base_url: Option<String>,
    /// 协议是否已确认。
    pub responses_verified: bool,
    /// 是否启用。
    pub enabled: bool,
    /// 是否已保存密钥(永不回显密钥本体)。
    pub has_key: bool,
    /// 用户手填的上下文窗口覆盖(tokens);`None` = 用模型目录的值。
    pub context_window: Option<u32>,
    /// 用户手填的单次回复上限覆盖(tokens)。
    pub max_output_tokens: Option<u32>,
    /// 实际生效的上下文窗口:覆盖优先,否则目录值;两处都没有则 `None`(界面如实说"窗口未知")。
    pub effective_context_window: Option<u32>,
    /// 窗口来源:目录里那条模型的可读名;`None` = 目录没有这个模型。
    pub window_source: Option<String>,
}

impl ProfileDto {
    /// 由存储记录、"是否已有密钥"与目录里该模型的事实构造。
    ///
    /// `catalog` 为 `None` 表示目录查不到这条模型 —— 此时只有用户手填的覆盖能给出窗口。
    #[must_use]
    pub fn new(
        record: ProfileRecord,
        has_key: bool,
        catalog: Option<crate::domain::agent::ModelWindow>,
    ) -> Self {
        let effective_context_window = record
            .context_window
            .or(catalog.as_ref().and_then(|f| f.context_window));
        Self {
            id: record.id,
            label: record.label,
            protocol: record.protocol,
            model: record.model,
            base_url: record.base_url,
            responses_verified: record.responses_verified,
            enabled: record.enabled,
            has_key,
            context_window: record.context_window,
            max_output_tokens: record.max_output_tokens,
            effective_context_window,
            window_source: catalog.map(|facts| facts.display_name),
        }
    }
}

/// 共享记忆条目。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDto {
    /// ID。
    pub id: String,
    /// 作用域。
    pub scope: MemoryScope,
    /// 主机 ID。
    pub conn_id: Option<String>,
    /// 内容。
    pub content: String,
    /// 是否启用。
    pub enabled: bool,
}

impl From<AgentMemory> for MemoryDto {
    /// 领域对象 → DTO。
    fn from(value: AgentMemory) -> Self {
        Self {
            id: value.id.as_str().to_owned(),
            scope: value.scope,
            conn_id: value.conn_id,
            content: value.content,
            enabled: value.enabled,
        }
    }
}

/// 发起一轮的受理结果。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SendAcceptedDto {
    /// 运行 ID。
    pub run_id: String,
    /// 线程 ID。
    pub thread_id: String,
    /// 起始事件序号。
    pub started_seq: i64,
    /// 本次 `on_event` Channel 的订阅 ID。
    ///
    /// 受理时这条 Channel 已经是该线程的 sink,前端必须拿它的 ID 去退订;
    /// 若前端再单独 `attach_agent_thread`,同一批增量会被投两遍。
    pub subscription_id: String,
}

/// 一段 token 数值区间(闭区间),界面档位与前端校验同源用(AGENTS.md §5)。
#[derive(Debug, Clone, Copy, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TokenRangeDto {
    /// 最小值(tokens)。
    pub min: u32,
    /// 最大值(tokens)。
    pub max: u32,
}

/// 接入点表单的 token 区间,由领域常量推导,前端不抄一份数字。
#[derive(Debug, Clone, Copy, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProfileLimitsDto {
    /// 上下文窗口允许区间。
    pub context_window: TokenRangeDto,
    /// 单次回复上限允许区间(上界与窗口一致;另须小于窗口,规则在领域层)。
    pub max_output_tokens: TokenRangeDto,
}

impl ProfileLimitsDto {
    /// 由领域层 [`crate::domain::agent::CONTEXT_WINDOW_RANGE`] 推导:
    /// 窗口与回复上限共用同一个上界,回复上限下界是 1。
    pub fn from_domain() -> Self {
        let (min, max) = crate::domain::agent::CONTEXT_WINDOW_RANGE;
        Self {
            context_window: TokenRangeDto { min, max },
            max_output_tokens: TokenRangeDto { min: 1, max },
        }
    }
}

/// 界面候选枚举的单点来源(AGENTS.md §5:前端禁止自己抄一份取值)。
///
/// 一次取回候选与区间,避免抽屉每次打开都发多条 IPC;审批模式档位不在这里,
/// 它由设置契约 `agent.approvalMode` 提供(校验与界面档位同源)。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentEnumsDto {
    /// 可用协议(只有两种新协议)。
    pub protocols: Vec<ProtocolKind>,
    /// 逐台批准的可选决策。
    pub approval_decisions: Vec<ApprovalDecision>,
    /// 共享记忆作用域。
    pub memory_scopes: Vec<MemoryScope>,
    /// 接入点表单的 token 区间(上下文窗口 / 单次回复上限)。
    pub profile_limits: ProfileLimitsDto,
}

/// 协议探测结果。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProbeDto {
    /// 是否支持要求的协议。
    pub supported: bool,
    /// 人话结论(失败原因同样用这一句)。
    pub message: String,
    /// 本次探测用量。
    pub usage: Option<AgentUsage>,
}

/// 测试接入点请求:直接对表单当前值探测,不落库。
///
/// 探测是「未验证自定义端点」变成「已验证」的唯一途径;若先落库再探测,
/// 未验证状态在领域构造时就会被拒(自定义 + Responses + 未验证 = 拒绝保存),
/// 探测请求永远发不出去 —— 因此这里携带待测事实本身,而不是已存配置的 ID。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TestProfileRequestDto {
    /// 已存配置的 ID;编辑态密钥留空时用它在后端取已保存的密钥,新建为空。
    #[serde(default)]
    pub id: Option<String>,
    /// 协议。
    pub protocol: ProtocolKind,
    /// 模型名。
    pub model: String,
    /// 自定义端点;空表示官方地址。
    #[serde(default)]
    pub base_url: Option<String>,
    /// 本轮填写的密钥(优先);空则回落已存密钥,两者都没有时拒绝。永不回显、不入日志。
    #[serde(default)]
    pub api_key: Option<String>,
}

/// 新建线程请求。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateThreadRequestDto {
    /// 标题(可空,默认"新对话")。
    #[serde(default)]
    pub title: String,
    /// 模型配置 ID。
    pub profile_id: String,
    /// 审批档位(不传用设置里的默认档)。
    #[serde(default)]
    pub approval_mode: Option<ApprovalMode>,
    /// 绑定会话。
    #[serde(default)]
    pub bound_session_id: Option<String>,
}

/// 修改线程请求(全部可选,只改传入项)。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateThreadRequestDto {
    /// 线程 ID。
    pub thread_id: String,
    /// 标题。
    #[serde(default)]
    pub title: Option<String>,
    /// 审批档位。
    #[serde(default)]
    pub approval_mode: Option<ApprovalMode>,
    /// 绑定会话;传空字符串表示解绑。
    #[serde(default)]
    pub bound_session_id: Option<String>,
    /// 模型配置 ID。
    #[serde(default)]
    pub profile_id: Option<String>,
}

/// 发起对话请求。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SendMessageRequestDto {
    /// 线程 ID。
    pub thread_id: String,
    /// 用户输入。
    pub prompt: String,
    /// 本轮临时绑定(不传则沿线程设置)。
    #[serde(default)]
    pub bound_session_id: Option<String>,
}

/// 线程 ID 请求。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadIdRequestDto {
    /// 线程 ID。
    pub thread_id: String,
}

/// 取消运行请求。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelRunRequestDto {
    /// 线程 ID。
    pub thread_id: String,
    /// 运行 ID。
    pub run_id: String,
}

/// 继续暂停运行请求(从断点上下文接着跑)。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResumeRunRequestDto {
    /// 线程 ID。
    pub thread_id: String,
    /// 暂停的运行 ID。
    pub run_id: String,
}

/// 单台主机的批准决策。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovalDecisionDto {
    /// 目标主机。
    pub conn_id: String,
    /// 决策。
    pub decision: ApprovalDecision,
}

/// 批准应答请求(逐台)。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RespondApprovalRequestDto {
    /// 请求 ID。
    pub request_id: String,
    /// 每台主机的决策。
    pub decisions: Vec<ApprovalDecisionDto>,
}

/// 保存模型配置请求。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpsertProfileRequestDto {
    /// 已有时传 ID;新建留空。
    #[serde(default)]
    pub id: Option<String>,
    /// 名称。
    pub label: String,
    /// 协议。
    pub protocol: ProtocolKind,
    /// 模型名。
    pub model: String,
    /// 自定义端点。
    #[serde(default)]
    pub base_url: Option<String>,
    /// 是否已确认支持要求的协议。
    #[serde(default)]
    pub responses_verified: bool,
    /// 密钥(不传表示保持不变;永不回显)。
    #[serde(default)]
    pub api_key: Option<String>,
    /// 是否启用。
    #[serde(default)]
    pub enabled: bool,
    /// 上下文窗口覆盖(tokens);不传 = 用模型目录的值。
    #[serde(default)]
    pub context_window: Option<u32>,
    /// 单次回复上限覆盖(tokens);不传 = 用模型目录的值。
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
}

/// 查模型目录里的窗口事实(接入点表单自动带出用)。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LookupModelRequestDto {
    /// 模型名(与接入点里填的一致)。
    pub model: String,
}

/// 模型目录返回的事实;字段为空表示目录没有这条记录,界面如实留空。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelWindowDto {
    /// 目录里的可读名。
    pub display_name: String,
    /// 一次请求能读写的最大 tokens。
    pub context_window: Option<u32>,
    /// 单次回复的最大 tokens。
    pub max_output_tokens: Option<u32>,
    /// 目录里有没有这条模型(没有时上面两项必为空)。
    pub known: bool,
}

/// ID 请求(profile / 记忆 / 订阅通用)。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentIdRequestDto {
    /// 目标 ID。
    pub id: String,
}

/// 退订请求。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DetachRequestDto {
    /// 线程 ID。
    pub thread_id: String,
    /// 订阅 ID。
    pub subscription_id: String,
}

/// 保存记忆请求。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpsertMemoryRequestDto {
    /// 已有则传 ID。
    #[serde(default)]
    pub id: Option<String>,
    /// 作用域。
    pub scope: MemoryScope,
    /// 主机 ID。
    #[serde(default)]
    pub conn_id: Option<String>,
    /// 内容。
    pub content: String,
    /// 是否启用。
    #[serde(default)]
    pub enabled: bool,
}

/// 作用域解析请求。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveTargetsRequestDto {
    /// 作用域。
    pub scope: crate::domain::agent::TargetScope,
}

/// 事件出口类型别名(契约导出与前端生成物同名)。
pub type AgentEventDto = AgentEvent;

#[cfg(test)]
mod tests {
    use super::*;

    /// 请求 DTO 拒绝契约外字段(AGENTS.md §5:禁止"未知字段静默忽略")。
    #[test]
    fn requests_reject_unknown_fields() {
        let err = serde_json::from_value::<SendMessageRequestDto>(serde_json::json!({
            "threadId": "t1",
            "prompt": "hi",
            "model": "gpt-5.6"
        }))
        .unwrap_err();
        assert!(err.to_string().contains("model"), "{err}");
        let ok = serde_json::from_value::<SendMessageRequestDto>(serde_json::json!({
            "threadId": "t1",
            "prompt": "hi"
        }))
        .unwrap();
        assert_eq!(ok.thread_id, "t1");
    }

    /// 可选请求字段允许缺省。
    #[test]
    fn optional_request_fields_default() {
        let draft = serde_json::from_value::<CreateThreadRequestDto>(serde_json::json!({
            "profileId": "p1"
        }))
        .unwrap();
        assert!(draft.title.is_empty());
        assert_eq!(draft.approval_mode, None);
    }

    /// profile DTO 永不含密钥字段,且窗口解析规则不外泄内部机制。
    #[test]
    fn profile_dto_has_no_secret_material() {
        let record = ProfileRecord {
            id: "p1".into(),
            label: "官方".into(),
            protocol: ProtocolKind::AnthropicMessages,
            model: "claude".into(),
            base_url: None,
            responses_verified: true,
            secret_ref: "llm:p1:api_key".into(),
            enabled: true,
            created_at: 0,
            context_window: None,
            max_output_tokens: None,
        };
        let catalog = Some(crate::domain::agent::ModelWindow {
            display_name: "Claude".into(),
            context_window: Some(200_000),
            max_output_tokens: Some(8_192),
        });
        let dto = ProfileDto::new(record.clone(), false, catalog.clone());
        let json = serde_json::to_value(&dto).unwrap();
        assert!(json.get("secretRef").is_none(), "引用键也不外泄");
        assert!(json.get("apiKey").is_none());
        assert_eq!(json["hasKey"], false);
        assert_eq!(json["protocol"], "anthropic_messages");
        // 没填覆盖 → 分母用目录值,并带出来源说明。
        assert_eq!(json["effectiveContextWindow"], 200_000);
        assert_eq!(json["windowSource"], "Claude");

        // 填了覆盖 → 覆盖赢。
        let overridden = ProfileDto::new(
            ProfileRecord {
                context_window: Some(64_000),
                ..record
            },
            false,
            catalog,
        );
        assert_eq!(overridden.effective_context_window, Some(64_000));
    }

    /// 快照与审计映射保持字段完整。
    #[test]
    fn mappings_preserve_fields() {
        let audit = AuditDto::from(ToolCallRecord {
            id: crate::domain::agent::CallId::new("c1").unwrap(),
            thread_id: crate::domain::agent::ThreadId::new("t1").unwrap(),
            run_id: crate::domain::agent::RunId::new("r1").unwrap(),
            tool_name: "exec".into(),
            category: ToolCategory::ReadOnly,
            conn_id: Some("k1".into()),
            args_json: "{}".into(),
            status: TargetStatus::Ok,
            approval: Some(ApprovalDecision::AllowedOnce),
            output_excerpt: Some("up 3 days".into()),
            duration_ms: Some(120),
        });
        let json = serde_json::to_value(&audit).unwrap();
        assert_eq!(json["toolName"], "exec");
        assert_eq!(json["status"], "ok");
        assert_eq!(json["approval"], "allowed_once");
        assert_eq!(json["outputExcerpt"], "up 3 days");
        assert_eq!(json["durationMs"], 120);
    }

    /// 自动放行的只读操作没有用户批准,审计里 approval 必须是 null 而不是假值。
    #[test]
    fn audit_keeps_absent_decision_as_null() {
        let json = serde_json::to_value(AuditDto::from(tool_call_without_decision())).unwrap();
        assert!(json["approval"].is_null());
        assert!(json["durationMs"].is_null());
    }

    /// 界面候选枚举必须与领域 `ALL` 逐项一致且按 serde 字面量落盘。
    /// 前端直接渲染这份返回值,任何缺项都会变成界面上选不到的能力。
    #[test]
    fn enums_mirror_domain_all_lists() {
        use crate::domain::agent::{ApprovalDecision as Decision, MemoryScope, ProtocolKind};
        let json = serde_json::to_value(AgentEnumsDto {
            protocols: ProtocolKind::ALL.to_vec(),
            approval_decisions: Decision::ALL.to_vec(),
            memory_scopes: MemoryScope::ALL.to_vec(),
            profile_limits: ProfileLimitsDto::from_domain(),
        })
        .unwrap();
        assert_eq!(
            json["protocols"],
            serde_json::json!(["openai_responses", "anthropic_messages"])
        );
        assert_eq!(
            json["approvalDecisions"],
            serde_json::json!(["denied", "allowed_once", "allowed_always"])
        );
        assert_eq!(
            json["memoryScopes"],
            serde_json::json!(["global", "connection"])
        );
        assert_eq!(
            json["approvalDecisions"].as_array().unwrap().len(),
            Decision::ALL.len()
        );
        // 区间必须与领域常量一致:前端按这份数字做档位与校验(AGENTS.md §5)。
        let (window_min, window_max) = crate::domain::agent::CONTEXT_WINDOW_RANGE;
        assert_eq!(
            json["profileLimits"],
            serde_json::json!({
                "contextWindow": { "min": window_min, "max": window_max },
                "maxOutputTokens": { "min": 1, "max": window_max },
            })
        );
    }

    /// 无人批准、未执行的审计行(拒绝路径)。
    fn tool_call_without_decision() -> ToolCallRecord {
        ToolCallRecord {
            id: crate::domain::agent::CallId::new("c2").unwrap(),
            thread_id: crate::domain::agent::ThreadId::new("t1").unwrap(),
            run_id: crate::domain::agent::RunId::new("r1").unwrap(),
            tool_name: "read_file".into(),
            category: ToolCategory::ReadOnly,
            conn_id: Some("k1".into()),
            args_json: "{\"path\":\"/etc/hosts\"}".into(),
            status: TargetStatus::Ok,
            approval: None,
            output_excerpt: None,
            duration_ms: None,
        }
    }
}
