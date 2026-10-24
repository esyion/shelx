//! Agent 工具契约:名称、说明、参数 JSON Schema、影响类别(AGENTS.md §4.3 端口定义)。
//!
//! 工具说明文本会直接进模型上下文,因此措辞就是给模型的行为约束:
//! 只读取证、写操作逐台批准、禁止把主机名当参数手写(只能从已配置连接里选)。

use schemars::JsonSchema;
use serde::Serialize;

use crate::domain::agent::{ApprovalMode, ToolCategory};

/// 类别判定方式:固定类别,或按命令内容判定(`exec`)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolPolicy {
    /// 固定类别。
    Fixed(ToolCategory),
    /// 由 argv 分类决定(只读清单内为只读,否则为改动)。
    CommandDriven,
}

/// 一个工具的静态描述。
#[derive(Debug, Clone, Copy)]
pub struct ToolSpec {
    /// 工具名(进模型契约,不超过 64 字符)。
    pub name: &'static str,
    /// 给模型看的说明。
    pub description: &'static str,
    /// 参数 JSON Schema。
    pub parameters: &'static str,
    /// 类别判定方式。
    pub policy: ToolPolicy,
}

impl ToolSpec {
    /// 该工具在给定入参下的类别。
    pub fn category_for(&self, argv: Option<&[String]>) -> ToolCategory {
        match self.policy {
            ToolPolicy::Fixed(category) => category,
            ToolPolicy::CommandDriven => {
                crate::domain::agent::command_policy::classify_command(argv.unwrap_or_default())
                    .category
            }
        }
    }
}

/// 全部工具定义(单一来源:模型侧、审计侧、界面侧都从这里取)。
pub const ALL_TOOLS: &[ToolSpec] = &[
    ToolSpec {
        name: "list_connections",
        description: "列出用户在 shelx 里配置过的全部服务器(含离线)。返回 id、名称、地址、端口、登录用户、分组、备注与当前在线状态。所有其它工具的主机参数只能取自这里的 id。",
        parameters: r#"{"type":"object","properties":{"onlyOnline":{"type":"boolean","description":"仅返回当前在线的服务器"}},"additionalProperties":false}"#,
        policy: ToolPolicy::Fixed(ToolCategory::ReadOnly),
    },
    ToolSpec {
        name: "connection_detail",
        description: "查看单台服务器的配置详情(认证方式与是否已保存凭据;绝不返回凭据本体)。",
        parameters: r#"{"type":"object","properties":{"connId":{"type":"string"}},"required":["connId"],"additionalProperties":false}"#,
        policy: ToolPolicy::Fixed(ToolCategory::ReadOnly),
    },
    ToolSpec {
        name: "ensure_session",
        description: "为某台已配置的服务器建立 SSH 会话;若已在线则复用,不重复认证。需要交互认证(OTP、首次主机指纹确认)时会交回给用户处理,不会替用户决定。",
        parameters: r#"{"type":"object","properties":{"connId":{"type":"string"}},"required":["connId"],"additionalProperties":false}"#,
        policy: ToolPolicy::Fixed(ToolCategory::Connect),
    },
    ToolSpec {
        name: "server_info",
        description: "读取单台服务器的系统摘要(主机名、内核、发行版、CPU、内存、启动时间)。已采集过则直接返回缓存。",
        parameters: r#"{"type":"object","properties":{"connId":{"type":"string"}},"required":["connId"],"additionalProperties":false}"#,
        policy: ToolPolicy::Fixed(ToolCategory::ReadOnly),
    },
    ToolSpec {
        name: "exec",
        description: "在服务器上执行一条命令。必须以 argv 数组给出(禁止 shell 字符串、管道、重定向);命中只读白名单的取证命令自动执行,其它命令需要用户逐台批准。可同时面向多台主机。",
        parameters: r#"{"type":"object","properties":{"connIds":{"type":"array","items":{"type":"string"},"description":"目标服务器 id 列表,取自 list_connections"},"argv":{"type":"array","items":{"type":"string"},"description":"命令与参数数组,例如 [\"systemctl\",\"status\",\"nginx\"]"},"timeoutSecs":{"type":"integer","minimum":1,"maximum":120}},"required":["connIds","argv"],"additionalProperties":false}"#,
        policy: ToolPolicy::CommandDriven,
    },
    ToolSpec {
        name: "read_file",
        description: "读取远端文本文件(仅绝对路径,最多 64 KiB,超出截断)。用于看配置、脚本、单元文件等。",
        parameters: r#"{"type":"object","properties":{"connId":{"type":"string"},"path":{"type":"string","description":"远端绝对路径"}},"required":["connId","path"],"additionalProperties":false}"#,
        policy: ToolPolicy::Fixed(ToolCategory::ReadOnly),
    },
    ToolSpec {
        name: "list_dir",
        description: "列出远端目录条目(名称、类型、大小、修改时间)。",
        parameters: r#"{"type":"object","properties":{"connId":{"type":"string"},"path":{"type":"string"}},"required":["connId","path"],"additionalProperties":false}"#,
        policy: ToolPolicy::Fixed(ToolCategory::ReadOnly),
    },
    ToolSpec {
        name: "tail_log",
        description: "读取远端日志文件末尾若干行(仅绝对路径,按字节上限截断)。",
        parameters: r#"{"type":"object","properties":{"connId":{"type":"string"},"path":{"type":"string"},"lines":{"type":"integer","minimum":1,"maximum":2000}},"required":["connId","path"],"additionalProperties":false}"#,
        policy: ToolPolicy::Fixed(ToolCategory::ReadOnly),
    },
    ToolSpec {
        name: "write_file",
        description: "写入或追加远端文本文件。会改动服务器,每台目标都需要用户批准。",
        parameters: r#"{"type":"object","properties":{"connIds":{"type":"array","items":{"type":"string"}},"path":{"type":"string"},"content":{"type":"string"},"mode":{"type":"string","enum":["overwrite","append"]}},"required":["connIds","path","content"],"additionalProperties":false}"#,
        policy: ToolPolicy::Fixed(ToolCategory::Mutating),
    },
    ToolSpec {
        name: "remove_path",
        description: "删除远端文件或空目录。不可恢复,每台目标都需要用户批准。",
        parameters: r#"{"type":"object","properties":{"connIds":{"type":"array","items":{"type":"string"}},"path":{"type":"string"},"kind":{"type":"string","enum":["file","dir"]}},"required":["connIds","path"],"additionalProperties":false}"#,
        policy: ToolPolicy::Fixed(ToolCategory::Mutating),
    },
    ToolSpec {
        name: "rename_path",
        description: "重命名/移动远端路径。会改动服务器,每台目标都需要用户批准。",
        parameters: r#"{"type":"object","properties":{"connIds":{"type":"array","items":{"type":"string"}},"oldPath":{"type":"string"},"newPath":{"type":"string"}},"required":["connIds","oldPath","newPath"],"additionalProperties":false}"#,
        policy: ToolPolicy::Fixed(ToolCategory::Mutating),
    },
    ToolSpec {
        name: "set_permissions",
        description: "修改远端路径权限位(chmod)。会改动服务器,每台目标都需要用户批准。",
        parameters: r#"{"type":"object","properties":{"connIds":{"type":"array","items":{"type":"string"}},"path":{"type":"string"},"mode":{"type":"string","pattern":"^[0-7]{3,4}$"}},"required":["connIds","path","mode"],"additionalProperties":false}"#,
        policy: ToolPolicy::Fixed(ToolCategory::Mutating),
    },
    ToolSpec {
        name: "web_search",
        description: "联网搜索公网最新信息(新闻、版本发布、文档、报错解法、价格等时效性内容),返回带来源链接的摘要。服务器上的事实仍以现场取证工具为准,不要用搜索结果替代。",
        parameters: r#"{"type":"object","properties":{"query":{"type":"string","description":"搜索关键词"},"maxResults":{"type":"integer","minimum":1,"maximum":10,"description":"返回条数,默认 5"}},"required":["query"],"additionalProperties":false}"#,
        policy: ToolPolicy::Fixed(ToolCategory::ReadOnly),
    },
    ToolSpec {
        name: "remember",
        description: "把一条运维事实写入共享记忆(跨对话可用)。写入前需要用户确认,禁止写入凭据、密钥或个人隐私。",
        parameters: r#"{"type":"object","properties":{"content":{"type":"string","maxLength":500},"scope":{"type":"string","enum":["global","connection"]},"connId":{"type":"string"}},"required":["content","scope"],"additionalProperties":false}"#,
        policy: ToolPolicy::Fixed(ToolCategory::Mutating),
    },
];

/// 按名称查工具定义。
pub fn spec(name: &str) -> Option<&'static ToolSpec> {
    ALL_TOOLS.iter().find(|tool| tool.name == name)
}

/// 给定审批模式下允许注册进模型的工具集。
///
/// "只读模式"直接把写工具从工具表里拿掉,而不是注册后再拒绝 —— 模型看不见才不会反复试探。
/// `web_search` 只在密钥已配置时注册:模型看得见却调不通的能力是死状态(AGENTS.md §4.1.1)。
pub fn tools_for(mode: ApprovalMode, web_search: bool) -> Vec<&'static ToolSpec> {
    ALL_TOOLS
        .iter()
        .filter(|tool| match tool.policy {
            ToolPolicy::Fixed(ToolCategory::ReadOnly) => true,
            _ => mode.allows_mutating_tools(),
        })
        .filter(|tool| tool.name != "web_search" || web_search)
        .collect()
}

/// 单台主机的执行结果。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolTargetOutcome {
    /// 目标连接 ID。
    pub conn_id: String,
    /// 目标显示名。
    pub conn_name: String,
    /// 终态。
    pub status: crate::domain::agent::TargetStatus,
    /// 输出摘要(截断后)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    /// 错误原文(与后端一致,不吞错)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 一次工具调用的整体结果(回给模型的载荷由此格式化生成)。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutcome {
    /// 是否全部成功。
    pub ok: bool,
    /// 是否需要用户介入(如 OTP 认证、主机指纹确认)。
    pub needs_user: bool,
    /// 总体摘要(一句话,含台数)。
    pub summary: String,
    /// 逐台结果。
    pub targets: Vec<ToolTargetOutcome>,
    /// 输出是否被截断。
    pub truncated: bool,
}

impl ToolOutcome {
    /// 构造成功结果。
    pub fn succeeded(summary: impl Into<String>, targets: Vec<ToolTargetOutcome>) -> Self {
        Self {
            ok: targets
                .iter()
                .all(|target| matches!(target.status, crate::domain::agent::TargetStatus::Ok)),
            needs_user: false,
            summary: summary.into(),
            targets,
            truncated: false,
        }
    }

    /// 构造需要用户处理的结果。
    pub fn needs_user(summary: impl Into<String>) -> Self {
        Self {
            ok: false,
            needs_user: true,
            summary: summary.into(),
            targets: Vec::new(),
            truncated: false,
        }
    }

    /// 构造失败结果(工具层错误,非远端执行失败)。
    pub fn failed(summary: impl Into<String>) -> Self {
        Self {
            ok: false,
            needs_user: false,
            summary: summary.into(),
            targets: Vec::new(),
            truncated: false,
        }
    }

    /// 序列化为回给模型的 JSON 载荷。
    pub fn to_payload(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|err| {
            tracing::error!("工具结果序列化失败: {err}");
            "{\"ok\":false,\"summary\":\"工具结果序列化失败\"}".to_owned()
        })
    }
}

/// 工具执行端口(实现见 [`super::tool_host::SshToolHost`])。
#[async_trait::async_trait]
pub trait ToolHost: Send + Sync {
    /// 执行一次工具调用;入参已由调用方按 [`spec`] 校验过必填字段。
    ///
    /// 实现内部负责:目标集合解析(拒绝未知主机)、审批询问、逐台执行与事件推送。
    async fn invoke(
        &self,
        context: std::sync::Arc<super::types::RunContext>,
        name: &str,
        arguments: serde_json::Value,
    ) -> ToolOutcome;
}
