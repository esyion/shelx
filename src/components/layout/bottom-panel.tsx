/**
 * 底部面板壳(PRD §6.1):SFTP 双栏 / 传输中心 互斥页签,Ctrl+J 显隐。
 * M2 前为占位。
 */
"use client";

import { cn } from "@/lib/utils";
import { useUiStore, type BottomPanel } from "@/stores/ui";

/** 页签定义。 */
const PANELS: { key: Exclude<BottomPanel, "hidden">; label: string }[] = [
  { key: "sftp", label: "SFTP 双栏" },
  { key: "transfers", label: "传输中心" },
];

/** 底部面板;隐藏时不占空间。 */
export function BottomPanel() {
  const bottomPanel = useUiStore((s) => s.bottomPanel);
  const toggle = useUiStore((s) => s.toggleBottomPanel);
  if (bottomPanel === "hidden") return null;

  return (
    <section className="flex h-44 shrink-0 flex-col border-t" aria-label="底部面板">
      <div className="flex items-center gap-1 border-b px-2 py-1">
        {PANELS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={cn(
              "rounded px-2 py-1 text-xs",
              bottomPanel === key
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60",
            )}
            onClick={() =>
              useUiStore.setState({ bottomPanel: key })
            }
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="ml-auto rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent/60"
          title="收起 (Ctrl+J)"
          onClick={toggle}
        >
          收起
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        {bottomPanel === "sftp"
          ? "SFTP 双栏 — M2 实现(本地/远程双栏、拖拽传输)"
          : "传输中心 — M2 实现(任务队列、进度与取消)"}
      </div>
    </section>
  );
}
