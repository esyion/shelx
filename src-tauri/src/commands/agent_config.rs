//! Agent 配置类 command:模型接入点、共享记忆与作用域解析(AGENTS.md §4.2)。

use tauri::State;

use crate::domain::agent::{ApprovalDecision, MemoryScope, ProtocolKind};
use crate::dto::agent::{
    AgentEnumsDto, AgentIdRequestDto, MemoryDto, ProbeDto, ProfileDto, ResolveTargetsRequestDto,
    TargetDto, UpsertMemoryRequestDto, UpsertProfileRequestDto,
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
                ProfileDto::new(record, has_key)
            })
            .collect()
    }))
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
        });
    map_err(saved.map(|record| {
        let has_key = state.agent.profile_key_present(&record.id);
        ProfileDto::new(record, has_key)
    }))
}

/// 删除模型接入点(同时清除其密钥)。
#[tauri::command]
pub fn delete_agent_profile(state: State<AppState>, request: AgentIdRequestDto) -> IpcResult<()> {
    map_err(state.agent.delete_profile(&request.id))
}

/// 测试接入点:真发一次最小请求,确认它支持要求的协议。
#[tauri::command]
pub async fn test_agent_profile(
    state: State<'_, AppState>,
    request: AgentIdRequestDto,
) -> Result<IpcResult<ProbeDto>, String> {
    let Some(record) = state.agent.profile(&request.id) else {
        return Ok(IpcResult::err(IpcError::new(
            IpcErrorCode::NotFound,
            "模型配置不存在",
        )));
    };
    let profile = match state.agent.profile_domain(&record.id) {
        Ok(profile) => profile,
        Err(err) => return Ok(IpcResult::err(to_ipc_error(err))),
    };
    let Some(api_key) = state.agent.profile_key(&record) else {
        return Ok(IpcResult::err(IpcError::new(
            IpcErrorCode::AgentKeyMissing,
            "还没有保存该接入点的 API 密钥",
        )));
    };
    let outcome = crate::infrastructure::agent::probe_protocol(&profile, &api_key).await;
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

/// 界面候选枚举(协议、批准决策、记忆作用域)一次取回,避免前端抄一份取值(AGENTS.md §5)。
#[tauri::command]
pub fn list_agent_enums() -> IpcResult<AgentEnumsDto> {
    IpcResult::ok(AgentEnumsDto {
        protocols: ProtocolKind::ALL.to_vec(),
        approval_decisions: ApprovalDecision::ALL.to_vec(),
        memory_scopes: MemoryScope::ALL.to_vec(),
    })
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
