/**
 * /transfers/conflict 在缺 ?taskId= 时显示。
 */
"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex h-screen max-w-sm flex-col gap-4 p-6">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="返回主界面"
          className="rounded-md p-2 hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">未指定传输任务</h1>
      </header>
      <p className="text-sm text-muted-foreground">
        没有提供任务 ID。冲突对话框在文件传输过程中由引擎自动触发,通常不需要手动打开。
      </p>
      <Button onClick={() => (window.location.href = "/")}>返回主页</Button>
    </main>
  );
}
