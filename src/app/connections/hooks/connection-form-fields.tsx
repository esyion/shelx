/**
 * /connections/new 与 /connections/[id]/edit 共用的表单 UI 渲染。
 */
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { AuthMethod, SecretSaveMode } from "@/types";
import type { ConnectionFormState } from "./use-connection-form";

/** 带标签的表单行。 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** 公共 props。 */
export interface ConnectionFormFieldsProps {
  form: ConnectionFormState;
  set: <K extends keyof ConnectionFormState>(
    key: K,
    value: ConnectionFormState[K],
  ) => void;
  /** 是否编辑模式(影响密码/口令占位提示)。 */
  isEdit: boolean;
}

/** 表单字段渲染。 */
export function ConnectionFormFields({ form, set, isEdit }: ConnectionFormFieldsProps) {
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="名称 *">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="主机 *">
          <Input
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="IP 或域名"
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="端口">
          <Input
            value={form.port}
            onChange={(e) => set("port", e.target.value)}
            inputMode="numeric"
          />
        </Field>
        <Field label="用户名 *">
          <Input
            value={form.username}
            onChange={(e) => set("username", e.target.value)}
          />
        </Field>
      </div>
      <Field label="认证方式">
        <NativeSelect
          value={form.authMethod}
          onChange={(e) => set("authMethod", e.target.value as AuthMethod)}
        >
          <option value="password">密码</option>
          <option value="private_key">私钥</option>
          <option value="keyboard_interactive">键盘交互(OTP)</option>
          <option value="agent">免密(默认密钥 / ssh-agent)</option>
        </NativeSelect>
      </Field>
      {form.authMethod === "password" && (
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label={`密码${isEdit ? "(留空 = 保留已存)" : ""}`}>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="保存方式">
            <NativeSelect
              value={form.passwordSave}
              onChange={(e) => set("passwordSave", e.target.value as SecretSaveMode)}
            >
              <option value="keyring">钥匙串</option>
              <option value="session">仅本次会话</option>
              <option value="never">不保存</option>
            </NativeSelect>
          </Field>
        </div>
      )}
      {form.authMethod === "private_key" && (
        <>
          <Field label="私钥路径(空 = ~/.ssh 默认密钥)">
            <Input
              value={form.privateKeyPath}
              onChange={(e) => set("privateKeyPath", e.target.value)}
              placeholder="~/.ssh/id_ed25519"
            />
          </Field>
          <Field label={`私钥口令${isEdit ? "(留空 = 保留已存)" : ""}`}>
            <Input
              type="password"
              value={form.passphrase}
              onChange={(e) => set("passphrase", e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="编码">
          <NativeSelect
            value={form.encoding}
            onChange={(e) => set("encoding", e.target.value as "utf-8" | "gbk")}
          >
            <option value="utf-8">UTF-8</option>
            <option value="gbk">GBK</option>
          </NativeSelect>
        </Field>
      </div>
      <Field label="备注">
        <Textarea
          value={form.remark}
          onChange={(e) => set("remark", e.target.value)}
          rows={2}
          placeholder="如:双11扩容临时机,12月回收"
        />
      </Field>
    </div>
  );
}
