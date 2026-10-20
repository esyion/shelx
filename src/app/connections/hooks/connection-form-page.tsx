/**
 * /connections/new 与 /connections/edit 共用的页面壳:
 * header + 表单 + 测试连接/保存操作 + 加载/缺失态。
 */
"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConnectionFormFields } from "./connection-form-fields";
import { useConnectionTest } from "./use-connection-test";
import type { useConnectionForm } from "./use-connection-form";

/** 共享页面壳 props。 */
export interface ConnectionFormPageProps {
  /** 标题(新建/编辑)。 */
  title: string;
  /** 表单 state(useConnectionForm 返回值)。 */
  form: ReturnType<typeof useConnectionForm>;
  /** 是否编辑模式。 */
  isEdit: boolean;
}

/** 页面壳:统一 header + 表单 + 操作按钮 + 返回。 */
export function ConnectionFormPage({
  title,
  form,
  isEdit,
}: ConnectionFormPageProps) {
  const router = useRouter();
  const test = useConnectionTest();

  /** 保存成功后返回主页(失败保留输入,由 hook 行内提示)。 */
  const onSave = async () => {
    const ok = await form.save();
    if (ok) router.push("/");
  };

  /** 测试连接:先字段级校验,不合法不发请求并聚焦第一个错误字段。 */
  const onTest = () => {
    if (!form.validate()) return;
    void test.run(form.form);
  };

  if (form.loading) {
    return (
      <main className="mx-auto flex h-screen max-w-2xl items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在读取连接信息…
      </main>
    );
  }

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

      {form.missing && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          未找到要编辑的连接,它可能已被删除。请返回主页从连接树重新打开。
        </p>
      )}

      <ConnectionFormFields
        form={form.form}
        set={form.set}
        isEdit={isEdit}
        errors={form.errors}
      />

      {test.result && (
        <p
          role={test.result.ok ? "status" : "alert"}
          className={cn(
            "rounded-md border p-3 text-xs",
            test.result.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {test.result.message}
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => router.push("/")}>
          取消
        </Button>
        <Button
          variant="outline"
          onClick={onTest}
          disabled={test.testing || form.missing}
        >
          {test.testing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              测试中…
            </>
          ) : (
            "测试连接"
          )}
        </Button>
        <Button
          onClick={() => void onSave()}
          disabled={form.saving || form.missing}
        >
          {form.saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </main>
  );
}
