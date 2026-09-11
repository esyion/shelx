/**
 * 底部面板壳(PRD §6.1):SFTP 双栏 / 传输中心 互斥页签,Ctrl+J 显隐。
 * M2 前为占位。
 */
"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FileManager } from "@/components/files/file-manager";
import { TransferCenter } from "@/components/transfers/transfer-center";
import { useTabsStore } from "@/stores/tabs";
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
          <Button
            key={key}
            variant="ghost"
            size="xs"
            className={cn(
              bottomPanel === key
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60",
            )}
            onClick={() =>
              useUiStore.setState({ bottomPanel: key })
            }
          >
            {label}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto text-muted-foreground hover:bg-accent/60"
          title="收起 (Ctrl+J)"
          onClick={toggle}
        >
          收起
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {bottomPanel === "sftp" ? (
          <BottomFileManager />
        ) : (
          <TransferCenter />
        )}
      </div>
    </section>
  );
}

/** 底部面板内嵌 FileManager:取当前激活标签的会话。 */
function BottomFileManager() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  return <FileManager sessionId={activeTab?.sessionId ?? null} />;
}
