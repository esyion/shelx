/**
 * /connections/edit 在缺 ?id= 或 id 无效时显示。
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
        <h1 className="text-lg font-semibold">未指定连接</h1>
      </header>
      <p className="text-sm text-muted-foreground">
        没有提供连接 ID。请从侧栏连接树右键选择"编辑"打开此页面。
      </p>
      <Button onClick={() => (window.location.href = "/")}>返回主页</Button>
    </main>
  );
}
