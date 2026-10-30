//! 语义检索 DTO(离线索引状态、准备动作与对话搜索)。
//!
//! 状态字段是扁平的 `state` + `message`,前端按 state 分支展示,不透传内部枚举值。

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// 语义索引状态(界面展示「准备 / 建立索引中 / 就绪 / 失败重试」)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SemanticStatusDto {
    /// 阶段:not_ready / preparing / ready / failed。
    pub state: SemanticPhaseDto,
    /// 失败原因(仅 failed 时有值,原样展示)。
    pub message: Option<String>,
}

/// 语义索引阶段。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SemanticPhaseDto {
    /// 尚未准备(需要用户点「准备」才开始下载模型)。
    NotReady,
    /// 正在下载模型或整理历史。
    Preparing,
    /// 就绪,搜索可用。
    Ready,
    /// 准备失败,可重试。
    Failed,
}

/// 对话搜索请求。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SearchConversationsRequestDto {
    /// 搜索词(按意思匹配,不必是原词;上限 200 字,与后端校验同源)。
    pub query: String,
}

/// 对话搜索命中。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConversationHitDto {
    /// 命中的对话 ID(点击即切换过去)。
    pub thread_id: String,
    /// 对话当前标题。
    pub title: String,
    /// 命中片段(问与答的节选)。
    pub snippet: String,
}
