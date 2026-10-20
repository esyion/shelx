/**
 * 结束进程确认框:文案与实际行为严格一致(Rust 端只发送 SIGTERM 退出请求,
 * 无强制击杀),并针对 root 进程给出额外风险提示。
 * 从 process-view.tsx 拆出以遵守单文件 300 行约束(AGENTS.md §4.1)。
 */
"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ProcessInfo } from "@/types";

/** 结束进程确认框属性。 */
export interface ProcessKillDialogProps {
  /** 待确认结束的进程;null 关闭确认框。 */
  target: ProcessInfo | null;
  /** 请求进行中:禁用按钮防连点。 */
  killing: boolean;
  /** 取消/关闭。 */
  onCancel: () => void;
  /** 确认发送退出请求。 */
  onConfirm: () => void;
}

/** 结束进程确认框。 */
export function ProcessKillDialog({
  target,
  killing,
  onCancel,
  onConfirm,
}: ProcessKillDialogProps) {
  const isRoot = target?.user === "root";
  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>结束进程 {target?.comm}?</AlertDialogTitle>
          <AlertDialogDescription>
            这会请求进程「{target?.comm}」(编号 {target?.pid})正常退出。
            如果它没有响应这个请求,会继续运行,你可能需要在终端里手动处理。
            {target?.args ? `它的启动命令:${target.args}。` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {isRoot && (
          <p className="rounded-md border border-orange-500/40 bg-orange-500/10 p-2 text-xs text-orange-600 dark:text-orange-400">
            注意:这个进程正以 root(系统管理员)身份运行,结束它可能影响服务器的
            正常服务。请确认你知道它是做什么的。
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={killing}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={killing}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {killing ? "正在请求…" : "结束进程"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
