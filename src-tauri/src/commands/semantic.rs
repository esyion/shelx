//! 语义检索 command(AGENTS.md §4.2 薄适配器)。
//!
//! 只做参数接收、边界校验与错误映射;下载模型、回填与检索都在应用层。

use tauri::State;

use crate::application::agent::semantic::SemanticStatus;
use crate::dto::common::IpcResult;
use crate::dto::semantic::{
    ConversationHitDto, SearchConversationsRequestDto, SemanticPhaseDto, SemanticStatusDto,
};
use crate::shared::error::{IpcError, IpcErrorCode};
use crate::state::AppState;

/// 语义索引当前状态。
#[tauri::command]
pub fn semantic_status(state: State<AppState>) -> IpcResult<SemanticStatusDto> {
    IpcResult::ok(to_status_dto(state.agent.semantic_status()))
}

/// 开始准备语义索引(下载离线模型并整理历史);立即返回,进度轮询状态。
#[tauri::command]
pub fn prepare_semantic_index(state: State<AppState>) -> IpcResult<()> {
    state.agent.prepare_semantic();
    IpcResult::ok(())
}

/// 语义搜索历史对话(按意思匹配,返回标题与命中片段)。
#[tauri::command]
pub fn search_conversations(
    state: State<AppState>,
    request: SearchConversationsRequestDto,
) -> IpcResult<Vec<ConversationHitDto>> {
    if request.query.trim().is_empty() {
        return IpcResult::err(IpcError::new(
            IpcErrorCode::InvalidArgument,
            "请输入要搜索的内容",
        ));
    }
    match state.agent.search_conversations(&request.query) {
        Ok(hits) => IpcResult::ok(
            hits.into_iter()
                .map(|hit| ConversationHitDto {
                    thread_id: hit.thread_id,
                    title: hit.title,
                    snippet: hit.snippet,
                })
                .collect(),
        ),
        Err(err) => IpcResult::err(super::agent::to_ipc_error(err)),
    }
}

/// 应用层状态 → IPC DTO。
fn to_status_dto(status: SemanticStatus) -> SemanticStatusDto {
    let (state, message) = match status {
        SemanticStatus::NotReady => (SemanticPhaseDto::NotReady, None),
        SemanticStatus::Preparing => (SemanticPhaseDto::Preparing, None),
        SemanticStatus::Ready => (SemanticPhaseDto::Ready, None),
        SemanticStatus::Failed { message } => (SemanticPhaseDto::Failed, Some(message)),
    };
    SemanticStatusDto { state, message }
}
