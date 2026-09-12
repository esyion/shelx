/**
 * /connections/new — 新建连接(真页面,原 ConnectionDialog 浮层)。
 */
"use client";

import { useConnectionForm } from "../hooks/use-connection-form";
import { ConnectionFormPage } from "../hooks/connection-form-page";

/** 新建连接页。 */
export default function NewConnectionPage() {
  const form = useConnectionForm({});
  return <ConnectionFormPage title="新建连接" form={form} isEdit={false} />;
}
