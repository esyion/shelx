//! Agent 配置类 command:模型接入点、共享记忆与作用域解析(AGENTS.md §4.2)。

use tauri::State;

use crate::domain::agent::{ApprovalDecision, MemoryScope, ProtocolKind};
use crate::dto::agent::{
    AgentEnumsDto, AgentIdRequestDto, LookupModelRequestDto, MemoryDto, ModelWindowDto, ProbeDto,
    ProfileDto, ProfileLimitsDto, ResolveTargetsRequestDto, SaveWebSearchKeyRequestDto, TargetDto,
    TestProfileRequestDto, TestWebSearchRequestDto, UpsertMemoryRequestDto,
    UpsertProfileRequestDto, WebSearchProbeDto, WebSearchStatusDto,
};
use crate::dto::common::IpcResult;
use crate::shared::error::{IpcError, IpcErrorCode};
use crate::state::AppState;

use super::agent::{map_err, to_ipc_error};

/// 列出模型接入点(不含密钥,只说明是否已保存)。
#[tauri::command]
pub fn list_agent_profiles(state: State<AppState>) -> IpcResult<Vec<ProfileDto>> {
    map_err(state.agent.profiles().map(|items| {
        items
            .into_iter()
            .map(|record| {
                let has_key = state.agent.profile_key_present(&record.id);
                let catalog = crate::infrastructure::agent::lookup_window(&record.model);
                ProfileDto::new(record, has_key, catalog)
            })
            .collect()
    }))
}

/// 查模型目录里该模型的窗口事实(接入点表单自动带出用)。
///
/// 目录是随包数据,不联网;查不到时 `known=false`,界面据此如实说明"窗口需手填",
/// 而不是拿一个猜的数当分母(AGENTS.md §4.1.1 无信息时留空)。
#[tauri::command]
pub fn lookup_agent_model(request: LookupModelRequestDto) -> IpcResult<ModelWindowDto> {
    let model = request.model.trim();
    if model.is_empty() {
        return IpcResult::err(IpcError::new(
            IpcErrorCode::InvalidArgument,
            "先填模型名才能查窗口",
        ));
    }
    let facts = crate::infrastructure::agent::lookup_window(model);
    IpcResult::ok(match facts {
        Some(facts) => ModelWindowDto {
            display_name: facts.display_name,
            context_window: facts.context_window,
            max_output_tokens: facts.max_output_tokens,
            known: true,
        },
        None => ModelWindowDto {
            display_name: model.to_owned(),
            context_window: None,
            max_output_tokens: None,
            known: false,
        },
    })
}

/// 保存模型接入点。
#[tauri::command]
pub fn upsert_agent_profile(
    state: State<AppState>,
    request: UpsertProfileRequestDto,
) -> IpcResult<ProfileDto> {
    if request.label.trim().is_empty() || request.model.trim().is_empty() {
        return IpcResult::err(IpcError::new(
            IpcErrorCode::InvalidArgument,
            "名称与模型都不能为空",
        ));
    }
    let model_for_catalog = request.model.clone();
    let saved = state
        .agent
        .save_profile(crate::application::agent::types::ProfileDraft {
            id: request.id,
            label: request.label,
            protocol: request.protocol,
            model: request.model,
            base_url: request.base_url,
            responses_verified: request.responses_verified,
            api_key: request.api_key,
            enabled: request.enabled,
            context_window: request.context_window,
            max_output_tokens: request.max_output_tokens,
        });
    map_err(saved.map(|record| {
        let has_key = state.agent.profile_key_present(&record.id);
        let catalog = crate::infrastructure::agent::lookup_window(&model_for_catalog);
        ProfileDto::new(record, has_key, catalog)
    }))
}

/// 删除模型接入点(同时清除其密钥)。
#[tauri::command]
pub fn delete_agent_profile(state: State<AppState>, request: AgentIdRequestDto) -> IpcResult<()> {
    map_err(state.agent.delete_profile(&request.id))
}

/// 测试接入点:对表单当前值真发一次最小补全("ping"),支持即确认协议。
///
/// 不落库:探测是未验证端点变已验证的唯一途径,先落库会被领域守卫
/// (自定义 + Responses + 未验证 = 拒绝保存)挡住,请求永远发不出去。
/// 密钥优先用本轮填写的;编辑态密钥留空时回落已保存的密钥;都不给则拒绝。
#[tauri::command]
pub async fn test_agent_profile(
    state: State<'_, AppState>,
    request: TestProfileRequestDto,
) -> Result<IpcResult<ProbeDto>, String> {
    let model = request.model.trim().to_owned();
    if model.is_empty() {
        return Ok(IpcResult::err(IpcError::new(
            IpcErrorCode::InvalidArgument,
            "先填模型名才能测试",
        )));
    }
    let base_url = request
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let api_key = match request
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(key) => key.to_owned(),
        None => {
            let Some(id) = request.id.as_deref() else {
                return Ok(IpcResult::err(IpcError::new(
                    IpcErrorCode::AgentKeyMissing,
                    "先填 API 密钥再测试",
                )));
            };
            let Some(record) = state.agent.profile(id) else {
                return Ok(IpcResult::err(IpcError::new(
                    IpcErrorCode::NotFound,
                    "模型配置不存在,取不到已保存的密钥",
                )));
            };
            let Some(key) = state.agent.profile_key(&record) else {
                return Ok(IpcResult::err(IpcError::new(
                    IpcErrorCode::AgentKeyMissing,
                    "该接入点还没有保存 API 密钥",
                )));
            };
            key
        }
    };
    let outcome = crate::infrastructure::agent::probe_protocol(
        request.protocol,
        &model,
        base_url.as_deref(),
        &api_key,
    )
    .await;
    let outcome = match outcome {
        Ok(outcome) => outcome,
        Err(err) => {
            return Ok(IpcResult::err(to_ipc_error(
                crate::application::agent::AgentError::from(ProbeFault(err)),
            )));
        }
    };
    Ok(IpcResult::ok(ProbeDto {
        supported: outcome.is_supported(),
        message: crate::infrastructure::agent::probe_message(outcome).to_owned(),
        usage: None,
    }))
}

/// 解析目标作用域 → 主机清单(界面显示"这次打到哪些机器")。
#[tauri::command]
pub fn resolve_agent_targets(
    state: State<AppState>,
    request: ResolveTargetsRequestDto,
) -> IpcResult<Vec<TargetDto>> {
    map_err(
        state
            .agent
            .resolve_targets(request.scope)
            .map(|items| items.into_iter().map(Into::into).collect()),
    )
}

/// 共享记忆列表。
#[tauri::command]
pub fn list_agent_memories(state: State<AppState>) -> IpcResult<Vec<MemoryDto>> {
    map_err(
        state
            .agent
            .memories()
            .map(|items| items.into_iter().map(Into::into).collect()),
    )
}

/// 保存记忆。
#[tauri::command]
pub fn upsert_agent_memory(
    state: State<AppState>,
    request: UpsertMemoryRequestDto,
) -> IpcResult<MemoryDto> {
    let saved = state.agent.upsert_memory(
        request.id,
        request.scope,
        request.conn_id,
        request.content,
        request.enabled,
    );
    map_err(saved.map(Into::into))
}

/// 删除记忆。
#[tauri::command]
pub fn delete_agent_memory(state: State<AppState>, request: AgentIdRequestDto) -> IpcResult<()> {
    map_err(state.agent.delete_memory(&request.id))
}

/// 界面候选枚举(协议、批准决策、记忆作用域与 token 区间)一次取回,
/// 避免前端抄一份取值(AGENTS.md §5)。
#[tauri::command]
pub fn list_agent_enums() -> IpcResult<AgentEnumsDto> {
    IpcResult::ok(AgentEnumsDto {
        protocols: ProtocolKind::ALL.to_vec(),
        approval_decisions: ApprovalDecision::ALL.to_vec(),
        memory_scopes: MemoryScope::ALL.to_vec(),
        profile_limits: ProfileLimitsDto::from_domain(),
    })
}

/// 联网搜索配置状态(只报"是否已配置",永不回显密钥)。
#[tauri::command]
pub fn get_web_search_status(state: State<AppState>) -> IpcResult<WebSearchStatusDto> {
    IpcResult::ok(WebSearchStatusDto {
        configured: state.agent.web_search_key_present(),
    })
}

/// 保存或清除联网搜索密钥(密钥只写系统安全存储;null/空白 = 清除)。
#[tauri::command]
pub fn save_web_search_key(
    state: State<AppState>,
    request: SaveWebSearchKeyRequestDto,
) -> IpcResult<WebSearchStatusDto> {
    map_err(
        state
            .agent
            .save_web_search_key(request.api_key.as_deref())
            .map(|configured| WebSearchStatusDto { configured }),
    )
}

/// 测试联网搜索:真发一次最小搜索验证密钥(消耗 1 次额度);
/// 密钥优先用本轮填写的,留空回落已存。
#[tauri::command]
pub async fn test_web_search_key(
    state: State<'_, AppState>,
    request: TestWebSearchRequestDto,
) -> Result<IpcResult<WebSearchProbeDto>, String> {
    let probe = match state
        .agent
        .probe_web_search(request.api_key.as_deref())
        .await
    {
        Ok(probe) => probe,
        Err(err) => return Ok(IpcResult::err(to_ipc_error(err))),
    };
    Ok(IpcResult::ok(WebSearchProbeDto::from(probe)))
}

/// provider 构造/探测失败的包装:借道应用层错误,保持错误码单一口径。
struct ProbeFault(crate::infrastructure::agent::ProviderError);

/// 探测失败 → 应用层错误语义。
impl From<ProbeFault> for crate::application::agent::AgentError {
    fn from(value: ProbeFault) -> Self {
        use crate::infrastructure::agent::ProviderError as Inner;
        match value.0 {
            Inner::MissingApiKey => crate::application::agent::AgentError::KeyMissing,
            Inner::Call(message) => crate::application::agent::AgentError::Invalid(message),
        }
    }
}
