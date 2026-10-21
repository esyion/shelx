/**
 * Agent 回答的 Markdown 渲染(流式)。
 *
 * 与更新日志弹窗同一 Streamdown 配置,但用 `streaming` 模式;链接一律经系统浏览器
 * 打开,避免在 WebView 内导航冲掉应用(终端与会话都是长连接状态)。
 */
import type { ComponentProps } from "react";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";
import { openExternalUrl } from "@/app/api";
import { Button } from "@/components/ui/button";

/** 链接改写为系统浏览器跳转(shadcn Button 的 link 变体,不手写 `<button>`)。 */
const components = {
  a: ({ href, children }: ComponentProps<"a">) => (
    <Button
      variant="link"
      className="h-auto p-0 text-sm leading-inherit"
      onClick={() => href && void openExternalUrl(href).catch(() => undefined)}
    >
      {children}
    </Button>
  ),
};

/**
 * 渲染一段(可能不完整的)模型输出。
 *
 * @param text 增量累积后的文本。
 * @param streaming 是否仍在流式输出中(影响 Streamdown 的分块策略)。
 */
export function AgentAnswer({ text, streaming }: { text: string; streaming: boolean }) {
  if (!text.trim()) return null;
  return (
    <div className="text-sm leading-relaxed">
      <Streamdown
        mode={streaming ? "streaming" : "static"}
        plugins={{ code, cjk }}
        linkSafety={{ enabled: false }}
        components={components}
      >
        {text}
      </Streamdown>
    </div>
  );
}
