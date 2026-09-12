/**
 * /connections/new 与 /connections/[id]/edit 共用的页面壳。
 */
"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectionFormFields } from "./connection-form-fields";
import type { useConnectionForm } from "./use-connection-form";

/** 共享页面壳 props。 */
export interface ConnectionFormPageProps {
  /** 标题(新建/编辑)。 */
  title: string;
  /** 表单 state。 */
  form: ReturnType<typeof useConnectionForm>;
  /** 是否编辑模式。 */
  isEdit: boolean;
}

/** 页面壳:统一 header + 表单 + 操作按钮 + 返回。 */
export function ConnectionFormPage({ title, form, isEdit }: ConnectionFormPageProps) {
  const router = useRouter();

  /** 保存。 */
  const onSave = async () => {
    const ok = await form.save();
    if (ok) router.push("/");
  };

  return (
    <main className="mx-auto flex h-screen max-w-2xl flex-col gap-4 overflow-y-auto p-6">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="返回主界面"
          className="rounded-md p-2 hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">{title}</h1>
        <span className="text-xs text-muted-foreground">保存后自动返回主页</span>
      </header>

      <ConnectionFormFields
        form={form.form}
        set={form.set}
        isEdit={isEdit}
      />

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => router.push("/")}>
          取消
        </Button>
        <Button onClick={() => void onSave()} disabled={form.saving || form.loading}>
          {form.saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </main>
  );
}
