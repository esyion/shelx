/**
 * /sessions/info 在缺 ?id= 时显示。
 */
"use client";

import Link from "next/link";
import { ArrowLeft, Server } from "lucide-react";
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
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Server className="size-4" />
          未指定会话
        </h1>
      </header>
      <p className="text-sm text-muted-foreground">
        没有提供会话 ID。请打开一个会话,然后从侧栏监控区的"系统信息"按钮进入。
      </p>
      <Button onClick={() => (window.location.href = "/")}>返回主页</Button>
    </main>
  );
}
