//! Agent 领域层:值对象、策略规则与领域错误(AGENTS.md §4.4)。
//!
//! 本层保持纯 Rust:不依赖 rig、不依赖 Tauri、不读环境变量、不访问文件与网络。
//! rig 的类型只允许出现在 `infrastructure/agent/`(防腐层,见 docs/AGENT_DESIGN.md §5.2),
//! 因此这里定义的是 shelx 自己的词汇,而不是 provider 词汇的转写。

pub mod command_policy;

use serde::{Deserialize, Serialize};

pub use command_policy::{CommandDecision, ToolCategory};

/// Agent 领域错误。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AgentDomainError {
    /// 标识为空或仅空白。
    #[error("标识不能为空")]
    EmptyIdentity,
    /// 名称为空。
    #[error("名称不能为空")]
    EmptyName,
    /// 目标主机集合为空(没有任何可操作主机)。
    #[error("没有可操作的主机")]
    EmptyTargets,
    /// 单次批量目标数超出允许上限。
    #[error("单次批量目标数 {count} 超出上限 {limit}")]
    TooManyTargets {
        /// 实际请求台数。
        count: usize,
        /// 允许上限。
        limit: usize,
    },
    /// 状态流转非法。
    #[error("运行状态不可从 {from} 流转到 {to}")]
    InvalidStatusTransition {
        /// 当前状态字面量。
        from: &'static str,
        /// 目标状态字面量。
        to: &'static str,
    },
    /// 协议不受支持(禁止旧协议)。
    #[error("该接入点不支持要求的协议:{0}")]
    UnsupportedProtocol(String),
    /// provider 或模型配置非法。
    #[error("模型配置非法:{0}")]
    InvalidProfile(String),
}

/// 生成字符串标识值对象宏:与 [`crate::domain::connection::ConnId`] 同一套约束口径。
macro_rules! agent_id {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub struct $name(String);

        impl $name {
            /// 构造标识;拒绝空串与纯空白。
            ///
            /// # Errors
            /// 值为空白 → [`AgentDomainError::EmptyIdentity`]。
            pub fn new(value: impl Into<String>) -> Result<Self, AgentDomainError> {
                let value = value.into();
                if value.trim().is_empty() {
                    return Err(AgentDomainError::EmptyIdentity);
                }
                Ok(Self(value))
            }

            /// 返回内部字符串,供持久化与 DTO 映射使用。
            pub fn as_str(&self) -> &str {
                &self.0
            }

            /// 消耗自身取回字符串。
            pub fn into_string(self) -> String {
                self.0
            }
        }
    };
}

agent_id!(
    /// Agent 对话线程标识(跨 IPC 与持久化统一 string,AGENTS.md §5)。
    ThreadId
);
agent_id!(
    /// 一次 Agent 运行标识。
    RunId
);
agent_id!(
    /// 模型接入配置(profile)标识。
    ProfileId
);
agent_id!(
    /// 工具调用标识。
    CallId
);
agent_id!(
    /// 共享记忆条目标识。
    MemoryId
);

/// Provider 协议种类。
///
/// 取值即协议本身:OpenAI 侧只允许 Responses API(`POST /responses`),
/// Anthropic 侧只允许 Messages API(`POST /v1/messages`)。Chat Completions
/// 不存在于本枚举中 —— 旧协议在领域层就没有表达位置(AGENTS.md §13)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProtocolKind {
    /// OpenAI Responses API。
    #[serde(rename = "openai_responses")]
    OpenAiResponses,
    /// Anthropic Messages API。
    #[serde(rename = "anthropic_messages")]
    AnthropicMessages,
}

impl ProtocolKind {
    /// 全部取值(供契约与下拉候选使用)。
    pub const ALL: [Self; 2] = [Self::OpenAiResponses, Self::AnthropicMessages];

    /// 稳定字面量,与 serde 序列化一致。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OpenAiResponses => "openai_responses",
            Self::AnthropicMessages => "anthropic_messages",
        }
    }

    /// 界面主文案(用户看得懂的协议名,不暴露内部枚举原值)。
    pub fn display_name(self) -> &'static str {
        match self {
            Self::OpenAiResponses => "OpenAI Responses",
            Self::AnthropicMessages => "Anthropic Messages",
        }
    }
}

/// 模型目录里关于一个模型的事实(值对象:窗口与上限是模型的属性,不是对话的属性)。
///
/// 由基础设施层的目录适配器填入;`None` 一律表示"目录没给",不允许用猜的数补上。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelWindow {
    /// 目录里的可读名(界面用它说明这个数是从哪条记录带出来的)。
    pub display_name: String,
    /// 一次请求能读写的最大 tokens。
    pub context_window: Option<u32>,
    /// 单次回复的最大 tokens。
    pub max_output_tokens: Option<u32>,
}

/// 模型接入配置:一台可被 Agent 使用的 provider 端点。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelProfile {
    /// 配置标识。
    pub id: ProfileId,
    /// 用户可读名称。
    pub label: String,
    /// 协议种类(决定端点形态)。
    pub protocol: ProtocolKind,
    /// 模型名(由后端下发候选,不允许用户手写)。
    pub model: String,
    /// 自定义接入点;`None` 表示官方默认端点。
    pub base_url: Option<String>,
    /// 该接入点是否声明并探测通过 Responses API(仅 OpenAI 侧有意义)。
    pub responses_verified: bool,
    /// 上下文窗口覆盖(tokens);`None` = 用模型目录里的值。
    pub context_window: Option<u32>,
    /// 单次回复上限覆盖(tokens);`None` = 用模型目录里的值。
    pub max_output_tokens: Option<u32>,
}

/// 手填窗口的合法区间:下限挡"单位填错/填 0",上限挡把 tokens 误填成 k 之类的打字错误。
/// 真实取值仍以模型目录为准,这里只保证存进去的数不会一眼就是错的。
pub const CONTEXT_WINDOW_RANGE: (u32, u32) = (1_000, 10_000_000);

impl ModelProfile {
    /// 构造并校验配置。
    ///
    /// 规则:名称非空;OpenAI 侧若使用自定义接入点,必须已通过 Responses 探测 ——
    /// 未探测/不支持的接入点在构造阶段就被拒绝,避免"能保存但永远发不出请求"。
    ///
    /// # Errors
    /// 名称空白 → [`AgentDomainError::EmptyName`];
    /// 模型名空白 → [`AgentDomainError::InvalidProfile`];
    /// 自定义接入点未验证 → [`AgentDomainError::UnsupportedProtocol`]。
    pub fn new(
        id: ProfileId,
        label: String,
        protocol: ProtocolKind,
        model: String,
        base_url: Option<String>,
        responses_verified: bool,
    ) -> Result<Self, AgentDomainError> {
        if label.trim().is_empty() {
            return Err(AgentDomainError::EmptyName);
        }
        if model.trim().is_empty() {
            return Err(AgentDomainError::InvalidProfile("模型名不能为空".into()));
        }
        let base_url = base_url
            .map(|value| value.trim().trim_end_matches('/').to_owned())
            .filter(|value| !value.is_empty());
        if matches!(protocol, ProtocolKind::OpenAiResponses)
            && base_url.is_some()
            && !responses_verified
        {
            return Err(AgentDomainError::UnsupportedProtocol(
                "自定义接入点未确认支持 Responses API".into(),
            ));
        }
        Ok(Self {
            id,
            label,
            protocol,
            model,
            base_url,
            responses_verified,
            context_window: None,
            max_output_tokens: None,
        })
    }

    /// 挂上手填的窗口与回复上限覆盖(两者都允许留空 = 用模型目录的值)。
    ///
    /// 规则:取值落在 [`CONTEXT_WINDOW_RANGE`];同时给出两者时,回复上限不得大于窗口 ——
    /// 否则这一轮永远发不出去(请求本身就把窗口占满),不如在保存时就拒绝。
    ///
    /// # Errors
    /// 越界或上限大于窗口 → [`AgentDomainError::InvalidProfile`]。
    pub fn with_limits(
        mut self,
        context_window: Option<u32>,
        max_output_tokens: Option<u32>,
    ) -> Result<Self, AgentDomainError> {
        let (min, max) = CONTEXT_WINDOW_RANGE;
        if let Some(window) = context_window {
            if !(min..=max).contains(&window) {
                return Err(AgentDomainError::InvalidProfile(format!(
                    "上下文窗口需在 {min}~{max} tokens 之间"
                )));
            }
        }
        if let Some(output) = max_output_tokens {
            if output == 0 || output > max {
                return Err(AgentDomainError::InvalidProfile(format!(
                    "单次回复上限需在 1~{max} tokens 之间"
                )));
            }
            if let Some(window) = context_window {
                if output >= window {
                    return Err(AgentDomainError::InvalidProfile(
                        "单次回复上限必须小于上下文窗口,否则请求没有留给历史的位置".into(),
                    ));
                }
            }
        }
        self.context_window = context_window;
        self.max_output_tokens = max_output_tokens;
        Ok(self)
    }

    /// 是否官方端点(官方端点无需探测即合规)。
    pub fn is_official(&self) -> bool {
        self.base_url.is_none()
    }

    /// 实际生效的上下文窗口:用户覆盖优先,否则用目录带出的值;两处都没有则 `None`。
    ///
    /// `None` 是合法状态 —— 界面此时如实说"窗口未知",不拿猜的数当分母。
    pub fn effective_context_window(&self, catalog: Option<u32>) -> Option<u32> {
        self.context_window.or(catalog)
    }
}

/// 审批模式(枚举带行为,不做自由文本,AGENTS.md §13)。
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalMode {
    /// 只读工具自动执行,写操作与建连逐次确认。
    #[default]
    ReadOnlyAuto,
    /// 任何工具都要点击确认。
    AllConfirm,
    /// 只注册只读工具(写工具不存在于本轮工具集)。
    ReadOnlyOnly,
}

impl ApprovalMode {
    /// 全部取值(供契约与下拉候选)。
    pub const ALL: [Self; 3] = [Self::ReadOnlyAuto, Self::AllConfirm, Self::ReadOnlyOnly];

    /// 稳定字面量。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadOnlyAuto => "read_only_auto",
            Self::AllConfirm => "all_confirm",
            Self::ReadOnlyOnly => "read_only_only",
        }
    }

    /// 该模式下这一类工具是否需要用户确认。
    pub fn requires_approval(self, category: ToolCategory) -> bool {
        match self {
            Self::ReadOnlyAuto => category != ToolCategory::ReadOnly,
            Self::AllConfirm => true,
            // 只读模式:非只读工具根本不会被注册进来,这里再兜一层。
            Self::ReadOnlyOnly => category != ToolCategory::ReadOnly,
        }
    }

    /// 该模式是否允许注册写操作工具。
    pub fn allows_mutating_tools(self) -> bool {
        !matches!(self, Self::ReadOnlyOnly)
    }
}

/// 单次工具调用的批准决策(粒度到"一台主机",见 docs/AGENT_DESIGN.md §7.2)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    /// 允许本次。
    AllowedOnce,
    /// 本线程内该主机该工具永久允许。
    AllowedAlways,
    /// 拒绝。
    Denied,
}

impl ApprovalDecision {
    /// 全部取值(供契约与界面候选,前端不得自己抄一份)。
    pub const ALL: [Self; 3] = [Self::Denied, Self::AllowedOnce, Self::AllowedAlways];
}

/// 批量目标选择方式。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum TargetScope {
    /// 指定连接 ID 列表。
    Ids {
        /// 连接 ID(字符串,AGENTS.md §5)。
        ids: Vec<String>,
    },
    /// 指定分组下的全部连接;`None` 为根目录。
    Group {
        /// 分组 ID;缺省表示根目录。
        group_id: Option<String>,
    },
    /// 当前在线会话对应的连接。
    Online,
    /// 用户配置过的全部连接(含离线)。
    AllConfigured,
}

/// 一次运行(Run)的状态机。
///
/// 合法流转:
/// - `Running → AwaitingApproval | Completed | Failed | Cancelled | Paused`
/// - `AwaitingApproval → Running | Cancelled | Failed`(批准恢复 / 用户取消 / 应用重启被判定过期)
///
/// `Completed`、`Cancelled`、`Paused` 为终态;`Failed` 后用户可在同线程重新发起(新 Run);
/// `Paused` 只因连续执行轮数到达上限,断点上下文随运行记录保存,继续时另起新 Run。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    /// 模型循环或工具执行进行中。
    Running,
    /// 等待用户批准工具调用。
    AwaitingApproval,
    /// 正常结束。
    Completed,
    /// 失败(含重启后待批准运行过期)。
    Failed,
    /// 用户取消。
    Cancelled,
    /// 连续执行轮数到达上限而暂停(可从断点继续)。
    Paused,
}

impl RunState {
    /// 稳定字面量。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::AwaitingApproval => "awaiting_approval",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Paused => "paused",
        }
    }

    /// 是否终态。
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled | Self::Paused)
    }

    /// 判断能否流转到目标状态。
    pub fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (
                Self::Running,
                Self::AwaitingApproval
                    | Self::Completed
                    | Self::Failed
                    | Self::Cancelled
                    | Self::Paused
            ) | (
                Self::AwaitingApproval,
                Self::Running | Self::Failed | Self::Cancelled
            )
        )
    }

    /// 消费当前状态执行流转;非法流转返回领域错误。
    ///
    /// # Errors
    /// 非法流转 → [`AgentDomainError::InvalidStatusTransition`]。
    pub fn transition_to(self, next: Self) -> Result<Self, AgentDomainError> {
        if self.can_transition_to(next) {
            Ok(next)
        } else {
            Err(AgentDomainError::InvalidStatusTransition {
                from: self.as_str(),
                to: next.as_str(),
            })
        }
    }
}

/// 批量执行中单台主机的状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TargetStatus {
    /// 排队中。
    Pending,
    /// 建连中。
    Connecting,
    /// 命令执行中。
    Running,
    /// 成功。
    Ok,
    /// 失败。
    Failed,
    /// 用户拒绝。
    Denied,
    /// 取消(尚未开始就被中止)。
    Cancelled,
    /// 等待批准。
    AwaitingApproval,
}

impl TargetStatus {
    /// 稳定字面量。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Connecting => "connecting",
            Self::Running => "running",
            Self::Ok => "ok",
            Self::Failed => "failed",
            Self::Denied => "denied",
            Self::Cancelled => "cancelled",
            Self::AwaitingApproval => "awaiting_approval",
        }
    }

    /// 是否终态(不再变化)。
    pub fn is_terminal(self) -> bool {
        !matches!(self, Self::Pending | Self::Connecting | Self::Running)
    }
}

/// 共享记忆条目的作用域。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScope {
    /// 全局事实(跨主机跨线程)。
    Global,
    /// 某台连接的事实。
    Connection,
}

impl MemoryScope {
    /// 全部取值。
    pub const ALL: [Self; 2] = [Self::Global, Self::Connection];

    /// 稳定字面量。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Global => "global",
            Self::Connection => "connection",
        }
    }
}

/// 一条共享记忆(结构化条目,不是自由 blob)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentMemory {
    /// 标识。
    pub id: MemoryId,
    /// 作用域。
    pub scope: MemoryScope,
    /// 作用域为主机时的连接 ID;全局条目为 `None`。
    pub conn_id: Option<String>,
    /// 记忆正文(进系统提示前按不可信数据定界)。
    pub content: String,
    /// 是否启用。
    pub enabled: bool,
}

impl AgentMemory {
    /// 单条记忆正文上限(字数);超出应拆条,避免把系统提示撑爆。
    pub const MAX_CONTENT_LEN: usize = 500;

    /// 构造记忆条目。
    ///
    /// # Errors
    /// 正文空白 → [`AgentDomainError::EmptyName`];超长 → [`AgentDomainError::InvalidProfile`];
    /// 作用域为主机但缺少连接 ID → [`AgentDomainError::EmptyIdentity`]。
    pub fn new(
        id: MemoryId,
        scope: MemoryScope,
        conn_id: Option<String>,
        content: String,
        enabled: bool,
    ) -> Result<Self, AgentDomainError> {
        if content.trim().is_empty() {
            return Err(AgentDomainError::EmptyName);
        }
        if content.chars().count() > Self::MAX_CONTENT_LEN {
            return Err(AgentDomainError::InvalidProfile(format!(
                "记忆内容最长 {} 字",
                Self::MAX_CONTENT_LEN
            )));
        }
        if scope == MemoryScope::Connection && conn_id.as_deref().unwrap_or("").trim().is_empty() {
            return Err(AgentDomainError::EmptyIdentity);
        }
        Ok(Self {
            id,
            scope,
            conn_id: if scope == MemoryScope::Connection {
                conn_id
            } else {
                None
            },
            content: content.trim().to_owned(),
            enabled,
        })
    }
}

/// 一次工具调用的审计记录(每台主机一行)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolCallRecord {
    /// 调用标识。
    pub id: CallId,
    /// 所属线程。
    pub thread_id: ThreadId,
    /// 所属运行。
    pub run_id: RunId,
    /// 工具名。
    pub tool_name: String,
    /// 类别。
    pub category: ToolCategory,
    /// 目标主机(不针对主机的工具为 `None`)。
    pub conn_id: Option<String>,
    /// 入参 JSON 原文(用于审计与批准展示)。
    pub args_json: String,
    /// 状态。
    pub status: TargetStatus,
    /// 批准决策;系统按档位自动放行的只读操作为 `None`(没有人批准过它)。
    pub approval: Option<ApprovalDecision>,
    /// 输出摘要(已按 `EXCERPT_CHARS` 截断);未执行或无输出为 `None`。
    pub output_excerpt: Option<String>,
    /// 该台主机上的执行耗时(毫秒);未取得执行许可就被拒绝/取消为 `None`。
    pub duration_ms: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 空白标识被拒绝。
    #[test]
    fn id_rejects_blank() {
        assert!(matches!(
            ThreadId::new("   "),
            Err(AgentDomainError::EmptyIdentity)
        ));
        assert!(ThreadId::new("t1").is_ok());
    }

    /// 协议枚举只有两种新协议,且字面量稳定。
    #[test]
    fn protocol_wire_literals_are_stable() {
        assert_eq!(ProtocolKind::ALL.len(), 2);
        for kind in ProtocolKind::ALL {
            let value = serde_json::to_value(kind).unwrap();
            assert_eq!(value, serde_json::json!(kind.as_str()));
        }
        assert_eq!(ProtocolKind::OpenAiResponses.as_str(), "openai_responses");
        assert_eq!(
            ProtocolKind::AnthropicMessages.as_str(),
            "anthropic_messages"
        );
    }

    /// 自定义 OpenAI 接入点未验证协议时不允许构造。
    #[test]
    fn custom_openai_profile_requires_verified_responses() {
        let id = ProfileId::new("p1").unwrap();
        let unverified = ModelProfile::new(
            id,
            "网关".into(),
            ProtocolKind::OpenAiResponses,
            "gpt-5".into(),
            Some("https://gw.example/v1".into()),
            false,
        );
        assert!(matches!(
            unverified,
            Err(AgentDomainError::UnsupportedProtocol(_))
        ));
        // 官方端点不需要探测。
        assert!(ModelProfile::new(
            ProfileId::new("p2").unwrap(),
            "官方".into(),
            ProtocolKind::OpenAiResponses,
            "gpt-5".into(),
            None,
            false,
        )
        .is_ok());
    }

    /// 手填窗口要过区间与"上限小于窗口"两道关(否则这一轮永远发不出去)。
    #[test]
    fn profile_window_overrides_are_validated() {
        let base = || {
            ModelProfile::new(
                ProfileId::new("pw").unwrap(),
                "官方".into(),
                ProtocolKind::AnthropicMessages,
                "claude".into(),
                None,
                false,
            )
            .unwrap()
        };

        let kept = base().with_limits(Some(200_000), Some(8_192)).unwrap();
        assert_eq!(kept.context_window, Some(200_000));
        assert_eq!(kept.max_output_tokens, Some(8_192));
        assert!(
            base().with_limits(Some(0), None).is_err(),
            "窗口 0 不是合法分母"
        );
        assert!(
            base().with_limits(Some(999), None).is_err(),
            "低于下限按填错处理"
        );
        assert!(
            base().with_limits(Some(8_000), Some(8_000)).is_err(),
            "回复上限等于窗口 = 历史没有位置"
        );
    }

    /// 生效窗口:覆盖优先,其次目录,两处都没有就如实是 None(不许伪造分母)。
    #[test]
    fn effective_window_prefers_override() {
        let base = ModelProfile::new(
            ProfileId::new("pe").unwrap(),
            "官方".into(),
            ProtocolKind::AnthropicMessages,
            "claude".into(),
            None,
            false,
        )
        .unwrap();
        assert_eq!(base.effective_context_window(None), None);
        assert_eq!(
            base.effective_context_window(Some(1_000_000)),
            Some(1_000_000)
        );
        let overridden = base.with_limits(Some(64_000), None).unwrap();
        assert_eq!(
            overridden.effective_context_window(Some(1_000_000)),
            Some(64_000),
            "用户填的覆盖必须赢过目录"
        );
    }

    /// 端点尾部斜杠被规范化,空串等价于未设置。
    #[test]
    fn base_url_is_normalized() {
        let profile = ModelProfile::new(
            ProfileId::new("p3").unwrap(),
            "网关".into(),
            ProtocolKind::AnthropicMessages,
            "claude".into(),
            Some("https://gw.example/v1/".into()),
            true,
        )
        .unwrap();
        assert_eq!(profile.base_url.as_deref(), Some("https://gw.example/v1"));
        let blank = ModelProfile::new(
            ProfileId::new("p4").unwrap(),
            "官方".into(),
            ProtocolKind::AnthropicMessages,
            "claude".into(),
            Some("   ".into()),
            true,
        )
        .unwrap();
        assert!(blank.is_official());
    }

    /// 审批模式与工具类别的对应关系。
    #[test]
    fn approval_mode_gates_categories() {
        assert!(!ApprovalMode::ReadOnlyAuto.requires_approval(ToolCategory::ReadOnly));
        assert!(ApprovalMode::ReadOnlyAuto.requires_approval(ToolCategory::Mutating));
        assert!(ApprovalMode::AllConfirm.requires_approval(ToolCategory::ReadOnly));
        assert!(!ApprovalMode::ReadOnlyOnly.allows_mutating_tools());
        assert!(ApprovalMode::ReadOnlyAuto.allows_mutating_tools());
    }

    /// 运行状态机只允许既定流转。
    #[test]
    fn run_state_transitions() {
        assert!(RunState::Running
            .transition_to(RunState::AwaitingApproval)
            .is_ok());
        assert!(RunState::Running.transition_to(RunState::Paused).is_ok());
        assert!(RunState::Paused.transition_to(RunState::Running).is_err());
        assert!(RunState::Paused.is_terminal());
        assert!(RunState::Completed
            .transition_to(RunState::Running)
            .is_err());
        assert!(RunState::AwaitingApproval
            .transition_to(RunState::Failed)
            .is_ok());
        assert!(RunState::Completed.is_terminal());
        assert!(!RunState::AwaitingApproval.is_terminal());
        assert_eq!(RunState::Paused.as_str(), "paused");
    }

    /// 单主机状态:等待批准即为非进行中状态。
    #[test]
    fn target_status_terminal_set() {
        assert!(!TargetStatus::Running.is_terminal());
        assert!(TargetStatus::Denied.is_terminal());
        assert_eq!(TargetStatus::AwaitingApproval.as_str(), "awaiting_approval");
    }

    /// 记忆条目校验。
    #[test]
    fn memory_validation() {
        let id = MemoryId::new("m1").unwrap();
        assert!(AgentMemory::new(id, MemoryScope::Global, None, "  ".into(), true).is_err());
        assert!(AgentMemory::new(
            MemoryId::new("m2").unwrap(),
            MemoryScope::Connection,
            None,
            "事实".into(),
            true,
        )
        .is_err());
        let ok = AgentMemory::new(
            MemoryId::new("m3").unwrap(),
            MemoryScope::Connection,
            Some("c1".into()),
            "  日志在 /data/logs  ".into(),
            true,
        )
        .unwrap();
        assert_eq!(ok.content, "日志在 /data/logs");
        // 全局条目不允许携带 conn_id。
        let global = AgentMemory::new(
            MemoryId::new("m4").unwrap(),
            MemoryScope::Global,
            Some("c1".into()),
            "事实".into(),
            true,
        )
        .unwrap();
        assert_eq!(global.conn_id, None);
    }

    /// 超长记忆被拒绝。
    #[test]
    fn memory_content_length_limit() {
        let long = "字".repeat(AgentMemory::MAX_CONTENT_LEN + 1);
        assert!(AgentMemory::new(
            MemoryId::new("m5").unwrap(),
            MemoryScope::Global,
            None,
            long,
            true
        )
        .is_err());
    }
}
