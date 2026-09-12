/**
 * /connections/edit?id=xxx — 编辑连接(真页面,原 ConnectionDialog 浮层)。
 *
 * URL 改用 query string 而非 [id] 路径段,因为 output:'export' 不支持
 * 运行时动态 ID(Next 文档明确:动态路由必须有 generateStaticParams())。
 */
"use client";

import { Suspense } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { useConnectionForm } from "../hooks/use-connection-form";
import { ConnectionFormPage } from "../hooks/connection-form-page";

/** 编辑连接内容(Suspense 包裹 useSearchParams + notFound)。 */
function EditConnectionForm() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  if (!id) notFound();
  const form = useConnectionForm({ connId: id });
  return <ConnectionFormPage title="编辑连接" form={form} isEdit={true} />;
}

/** 编辑连接页。 */
export default function EditConnectionPage() {
  return (
    <Suspense fallback={null}>
      <EditConnectionForm />
    </Suspense>
  );
}
