/**
 * 终端会话状态浮层(F7,PRD §6.3):连接中/已断开常驻在终端顶部。
 *
 * 断开时说明"内容仍在、可继续复制",并提供一键重新连接;重连失败只提示,
 * 不清空已保留的终端内容。
 */
"use client";

import { RotateCwIcon, UnplugIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { reconnectSession } from "@/app/api";
import { useSessionsStore } from "@/stores/sessions";
import type { SessionStatus } from "@/types";

/** 状态浮层属性。 */
export interface SessionStatusOverlayProps {
  /** 会话 ID(重新连接使用)。 */
  sessionId: string;
  /** 当前会话状态;online 时不渲染浮层。 */
  status: SessionStatus | undefined;
}

/** 会话状态浮层:非 online 时出现在终端顶部居中位置。 */
export function SessionStatusOverlay({
  sessionId,
  status,
}: SessionStatusOverlayProps) {
  if (status === "online") return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
      <div className="pointer-events-auto flex animate-in fade-in slide-in-from-top-2 items-center gap-2 rounded-full border border-border/60 bg-background/80 py-1 pl-1.5 pr-1.5 shadow-lg shadow-black/5 backdrop-blur-md">
        {status === "connecting" ? (
          <>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
              <Spinner className="size-3 text-muted-foreground" />
            </span>
            <span className="pr-1.5 text-xs text-muted-foreground">
              连接中…
            </span>
          </>
        ) : (
          <>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <UnplugIcon className="size-3 text-destructive" />
            </span>
            <span className="whitespace-nowrap text-xs">
              <span className="font-medium">连接已断开</span>
              <span className="text-muted-foreground"> · 内容保留可复制</span>
            </span>
            <Button
              size="xs"
              className="ml-0.5 rounded-full"
              onClick={() => void reconnectAndSync(sessionId)}
            >
              <RotateCwIcon data-icon="inline-start" />
              重新连接
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** 重连会话并把最新状态同步回 store;失败时 toast 告知,不影响已保留的终端内容。 */
async function reconnectAndSync(sessionId: string): Promise<void> {
  try {
    useSessionsStore.getState().upsert(await reconnectSession(sessionId));
  } catch (err) {
    const { useUiStore } = await import("@/stores/ui");
    useUiStore
      .getState()
      .toast(err instanceof Error ? err.message : "重连失败", "error");
  }
}
