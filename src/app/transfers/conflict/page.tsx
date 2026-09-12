/**
 * /transfers/conflict?taskId=xxx — 传输冲突决策(真页面,原 TransferConflictDialog 浮层)。
 *
 * 触发:transfer-enqueue 在收到 `awaiting_conflict` 事件后 router.push 此处。
 *
 * URL 改用 query string(见 connections/edit 说明)。缺 ?taskId= 时由 not-found.tsx 接管。
 */
"use client";

import { Suspense, useState } from "react";
import { notFound, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { respondTransferConflict } from "@/app/api";
import { useTransferStore } from "@/stores/transfer";
import type { ConflictDecision } from "@/types";

/** 冲突决策内容(Suspense 包裹 useSearchParams + notFound)。 */
function TransferConflictContent() {
  const searchParams = useSearchParams();
  const taskId = searchParams.get("taskId");
  if (!taskId) notFound();
  return <TransferConflictBody taskId={taskId} />;
}

/** 冲突决策内容。 */
function TransferConflictBody({ taskId }: { taskId: string }) {
  const router = useRouter();
  const task = useTransferStore((s) => s.byId[taskId]);
  const [applyToRemaining, setApplyToRemaining] = useState(false);

  /** 任务已过期:返回主页。 */
  if (!task) {
    return (
      <main className="mx-auto flex h-screen max-w-sm flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">任务不存在或已过期。</p>
        <Button variant="outline" onClick={() => router.push("/")}>
          返回
        </Button>
      </main>
    );
  }

  const answer = async (decision: ConflictDecision) => {
    await respondTransferConflict(taskId, decision, applyToRemaining);
    router.push("/");
  };

  return (
    <main className="mx-auto flex h-screen max-w-sm flex-col gap-4 overflow-y-auto p-6">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="返回主界面"
          className="rounded-md p-2 hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">目标已存在同名文件</h1>
      </header>

      <p className="break-all text-xs text-muted-foreground">
        {task.direction === "upload" ? task.remotePath : task.localPath}
      </p>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={applyToRemaining}
          onCheckedChange={(checked) => setApplyToRemaining(checked === true)}
        />
        对剩余冲突应用同样选择
      </label>

      <div className="grid grid-cols-4 gap-1">
        <Button variant="outline" onClick={() => router.push("/")}>
          取消
        </Button>
        <Button variant="outline" onClick={() => void answer("skip")}>
          跳过
        </Button>
        <Button variant="outline" onClick={() => void answer("rename")}>
          保留两者
        </Button>
        <Button onClick={() => void answer("overwrite")}>覆盖</Button>
      </div>
    </main>
  );
}

/** 冲突决策页。 */
export default function TransferConflictPage() {
  return (
    <Suspense fallback={null}>
      <TransferConflictContent />
    </Suspense>
  );
}
