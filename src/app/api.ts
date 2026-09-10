import { invokeCmd } from "@/gateway";
import type { IpcResult } from "@/types";

/** greet 冒烟请求体(与 Rust 端 dto::greet::GreetRequest 对齐)。 */
export interface GreetRequest {
  name: string;
}

/** greet 冒烟响应体(与 Rust 端 dto::greet::GreetResponse 对齐)。 */
export interface GreetResponse {
  message: string;
}

/**
 * 调用后端 greet 冒烟 command(演示 DTO + IpcResult 契约)。
 * 仅用于验证 Next.js 前端 ↔ Tauri IPC 链路是否贯通,后续业务模块会替换本文件。
 *
 * @param name 问候目标名称
 * @returns Rust 端拼装的问候语
 * @throws 边界校验失败等结构化错误
 */
export async function greet(name: string): Promise<string> {
  const result = await invokeCmd<IpcResult<GreetResponse>>("greet", {
    request: { name } satisfies GreetRequest,
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data.message;
}
