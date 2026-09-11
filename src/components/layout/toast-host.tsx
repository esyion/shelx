/**
 * 轻量 Toast 宿主:渲染 ui store 中的提示条(替代未引入的 sonner)。
 */
"use client";

import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

/** 右下角提示栈。 */
export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md",
            toast.variant === "error" && "border-red-500/40",
          )}
        >
          {toast.variant === "error" ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-500" />
          ) : (
            <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="break-all">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
