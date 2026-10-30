/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。
   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */

/**
 * 语义索引阶段。
 */
export type SemanticPhaseDto = "not_ready" | "preparing" | "ready" | "failed";

/**
 * 对话搜索命中。
 */
export interface ConversationHitDto {
  /**
   * 命中片段(问与答的节选)。
   */
  snippet: string;
  /**
   * 命中的对话 ID(点击即切换过去)。
   */
  threadId: string;
  /**
   * 对话当前标题。
   */
  title: string;
}
/**
 * 对话搜索请求。
 */
export interface SearchConversationsRequestDto {
  /**
   * 搜索词(按意思匹配,不必是原词;上限 200 字,与后端校验同源)。
   */
  query: string;
}
/**
 * 语义索引状态(界面展示「准备 / 建立索引中 / 就绪 / 失败重试」)。
 */
export interface SemanticStatusDto {
  /**
   * 失败原因(仅 failed 时有值,原样展示)。
   */
  message: string | null;
  state: SemanticPhaseDto;
}
