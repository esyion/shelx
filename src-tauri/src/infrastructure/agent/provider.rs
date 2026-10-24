//! Provider 单点构造与协议守卫(AGENTS.md §4.5;docs/AGENT_DESIGN.md §4.2 守卫 1)。
//!
//! 全项目只有这里允许出现 `OpenAIConfig` / `AnthropicConfig` 字面量。两条硬规则:
//! 1. OpenAI 侧一律强制 `Route::Responses`,禁止 Chat Completions(旧协议在本项目无表达位置);
//! 2. Anthropic 侧只有 Messages API 一条路径,天然合规。
//!
//! 上层拿到的只是 [`rig::DynModel`],不知道背后是哪家 provider,也不接触 rig 类型。

use rig::completion::CompletionRequest;
use rig::http_client::Error as HttpError;
use rig::operation::Completion;
use rig::providers::anthropic::AnthropicConfig;
use rig::providers::openai::{OpenAIConfig, Route};
use rig::DynModel;
use thiserror::Error;

use crate::domain::agent::{ModelProfile, ProtocolKind};

/// 协议探测结论(用于 profile 保存前的能力确认)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeOutcome {
    /// 该端点接受要求的协议。
    Supported,
    /// 端点不存在该协议路径(通常是网关只实现了旧协议)。
    Unsupported,
    /// 凭据被拒。
    CredentialRejected,
    /// 其它失败(网络、超时、解析),原文随附。
    Other(String),
}

impl ProbeOutcome {
    /// 是否可判定为"支持要求的协议"。
    pub fn is_supported(&self) -> bool {
        *self == Self::Supported
    }
}

/// 构造错误。
#[derive(Debug, Error)]
pub enum ProviderError {
    /// API Key 为空(界面必须先收到密钥)。
    #[error("缺少 API 密钥")]
    MissingApiKey,
    /// provider 调用失败,消息已脱敏(不含密钥)。
    #[error("模型服务调用失败:{0}")]
    Call(String),
}

/// 该 profile 应当命中的 HTTP 路径(协议守卫测试的断言口径)。
pub fn expected_path(protocol: ProtocolKind) -> &'static str {
    match protocol {
        ProtocolKind::OpenAiResponses => "/responses",
        ProtocolKind::AnthropicMessages => "/v1/messages",
    }
}

/// OpenAI 侧强制使用的路由(守卫 1 的唯一取值)。
pub fn enforced_openai_route() -> Route {
    Route::Responses
}

/// 由 profile 与密钥构造可执行的补全模型。
///
/// # Errors
/// 密钥空白 → [`ProviderError::MissingApiKey`]。
pub fn build_model(
    profile: &ModelProfile,
    api_key: &str,
) -> Result<DynModel<Completion>, ProviderError> {
    build_completion(
        profile.protocol,
        profile.model.clone(),
        profile.base_url.as_deref(),
        api_key,
    )
}

/// 由协议、模型与端点直接构造可执行补全(正式对话与连通性探测共用)。
///
/// 不经过 [`ModelProfile`]:探测必须在「未验证」状态下发生,而领域构造
/// 会拒绝未验证的自定义端点 —— 那道守卫管落库,不管探测。
///
/// # Errors
/// 密钥空白 → [`ProviderError::MissingApiKey`]。
pub fn build_completion(
    protocol: ProtocolKind,
    model: String,
    base_url: Option<&str>,
    api_key: &str,
) -> Result<DynModel<Completion>, ProviderError> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err(ProviderError::MissingApiKey);
    }
    Ok(match protocol {
        ProtocolKind::OpenAiResponses => {
            let mut config = OpenAIConfig::new(key).with_route(enforced_openai_route());
            if let Some(base_url) = base_url {
                config = config.with_base_url(base_url.to_owned());
            }
            debug_assert_eq!(config.completion_route(), Route::Responses);
            config.client().completion(model).into()
        }
        ProtocolKind::AnthropicMessages => {
            let mut config = AnthropicConfig::new(key);
            if let Some(base_url) = base_url {
                config = config.with_base_url(base_url);
            }
            config.client().completion(model).into()
        }
    })
}

/// 发一次最小补全请求,确认端点真的实现了要求的协议。
///
/// 只用于 profile 保存前的探测;失败按语义分类,便于界面把错误定位到具体原因。
/// 直接收协议、模型与端点事实:探测对象可以尚未通过验证、尚未落库。
///
/// # Errors
/// 密钥空白 → [`ProviderError::MissingApiKey`]。
pub async fn probe_protocol(
    protocol: ProtocolKind,
    model: &str,
    base_url: Option<&str>,
    api_key: &str,
) -> Result<ProbeOutcome, ProviderError> {
    let completion = build_completion(protocol, model.to_owned(), base_url, api_key)?;
    match completion.call(CompletionRequest::new("ping")).await {
        Ok(_) => Ok(ProbeOutcome::Supported),
        Err(err) => Ok(classify_probe_error(&err)),
    }
}

/// 把 provider 错误归类成探测结论。
fn classify_probe_error(err: &rig::ProviderError) -> ProbeOutcome {
    if matches!(err, rig::ProviderError::InvalidAuthentication(_)) {
        return ProbeOutcome::CredentialRejected;
    }
    if let rig::ProviderError::Http(http_err) = err {
        if let HttpError::InvalidStatusCodeWithDetails { status, .. } = http_err.as_ref() {
            return match status.as_u16() {
                401 | 403 => ProbeOutcome::CredentialRejected,
                404 | 405 | 501 => ProbeOutcome::Unsupported,
                code => ProbeOutcome::Other(format!("HTTP {code}")),
            };
        }
    }
    ProbeOutcome::Other(err.to_string())
}

/// 探测结论的中文说明(界面直接展示,不暴露内部枚举原值)。
pub fn probe_message(outcome: ProbeOutcome) -> &'static str {
    match outcome {
        ProbeOutcome::Supported => "接入点支持要求的协议",
        ProbeOutcome::Unsupported => "该接入点不提供本项目要求的协议(只实现旧版接口的网关无法使用)",
        ProbeOutcome::CredentialRejected => "密钥被接入点拒绝",
        ProbeOutcome::Other(_) => "接入点未能完成协议确认,请检查地址、网络或稍后重试",
    }
}
