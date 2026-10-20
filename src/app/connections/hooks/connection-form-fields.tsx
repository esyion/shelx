/**
 * /connections/new 与 /connections/edit 共用的表单 UI 渲染。
 *
 * 设计约束(产品硬规则:系统替用户翻译内部模型):
 * 选项文案面向用户并解释后果,语义对齐 Rust(见 `src/lib/connection-options.ts`)。
 * - 必填/端口校验以字段级行内错误呈现(aria-invalid + FieldError),不做聚合 toast;
 * - 私钥路径用 ~/.ssh 候选下拉(PrivateKeyField),不再要求用户手敲路径。
 */
"use client";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import {
  AUTH_METHOD_OPTIONS,
  SECRET_SAVE_OPTIONS,
  authMethodOption,
} from "@/lib/connection-options";
import {
  CONNECTION_FIELD_IDS,
  type ConnectionFormErrors,
  type ConnectionFormState,
} from "./use-connection-form";
import { PrivateKeyField } from "./private-key-field";
import type { AuthMethod, SecretSaveMode } from "@/types";

/** 表单行:标签 + 控件 + 说明/行内错误(shadcn Field)。 */
function FormRow({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </FieldLabel>
      <FieldContent>
        {children}
        {hint && !error ? (
          <FieldDescription className="text-xs">{hint}</FieldDescription>
        ) : null}
        {error ? <FieldError className="text-xs">{error}</FieldError> : null}
      </FieldContent>
    </Field>
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
  /** 字段级校验错误(由 useConnectionForm 产出)。 */
  errors: ConnectionFormErrors;
}

/** 表单字段渲染。 */
export function ConnectionFormFields({
  form,
  set,
  isEdit,
  errors,
}: ConnectionFormFieldsProps) {
  const authHint = authMethodOption(form.authMethod).hint;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="名称 *" htmlFor={CONNECTION_FIELD_IDS.name} error={errors.name}>
          <Input
            id={CONNECTION_FIELD_IDS.name}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            aria-invalid={errors.name ? true : undefined}
            placeholder="如:公司测试机"
            className="text-xs"
          />
        </FormRow>
        <FormRow label="主机 *" htmlFor={CONNECTION_FIELD_IDS.host} error={errors.host}>
          <Input
            id={CONNECTION_FIELD_IDS.host}
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            aria-invalid={errors.host ? true : undefined}
            placeholder="IP 或域名"
            className="text-xs"
          />
        </FormRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormRow
          label="端口"
          htmlFor={CONNECTION_FIELD_IDS.port}
          error={errors.port}
          hint="SSH 默认 22,一般不用改"
        >
          <Input
            id={CONNECTION_FIELD_IDS.port}
            value={form.port}
            onChange={(e) => set("port", e.target.value)}
            aria-invalid={errors.port ? true : undefined}
            inputMode="numeric"
            className="text-xs"
          />
        </FormRow>
        <FormRow label="用户名 *" htmlFor={CONNECTION_FIELD_IDS.username} error={errors.username}>
          <Input
            id={CONNECTION_FIELD_IDS.username}
            value={form.username}
            onChange={(e) => set("username", e.target.value)}
            aria-invalid={errors.username ? true : undefined}
            className="text-xs"
          />
        </FormRow>
      </div>
      <FormRow label="怎么登录服务器?" hint={authHint}>
        <NativeSelect
          value={form.authMethod}
          onChange={(e) => set("authMethod", e.target.value as AuthMethod)}
          className="text-xs"
        >
          {AUTH_METHOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </FormRow>
      {form.authMethod === "password" && (
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <FormRow label={`密码${isEdit ? "(留空 = 保留已存)" : ""}`}>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              autoComplete="new-password"
              className="text-xs"
            />
          </FormRow>
          <FormRow label="密码怎么保管?">
            <NativeSelect
              value={form.passwordSave}
              onChange={(e) =>
                set("passwordSave", e.target.value as SecretSaveMode)
              }
              className="text-xs"
            >
              {SECRET_SAVE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </FormRow>
        </div>
      )}
      {form.authMethod === "private_key" && (
        <>
          <FormRow
            label="私钥文件"
            hint="留空 = 自动使用本机默认密钥,一般不用改"
          >
            <PrivateKeyField
              value={form.privateKeyPath}
              onChange={(path) => set("privateKeyPath", path)}
            />
          </FormRow>
          <FormRow
            label={`私钥口令${isEdit ? "(留空 = 保留已存)" : ""}`}
            hint="仅当你的密钥设有保护口令时才需要填;没有就留空"
          >
            <Input
              type="password"
              value={form.passphrase}
              onChange={(e) => set("passphrase", e.target.value)}
              autoComplete="new-password"
              className="text-xs"
            />
          </FormRow>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormRow
          label="文字编码"
          hint="保持 UTF-8 即可;若连接后终端里的中文是乱码(常见于较老的中文服务器),再改为 GBK"
        >
          <NativeSelect
            value={form.encoding}
            onChange={(e) => set("encoding", e.target.value as "utf-8" | "gbk")}
            className="text-xs"
          >
            <option value="utf-8">UTF-8(默认)</option>
            <option value="gbk">GBK(老中文服务器)</option>
          </NativeSelect>
        </FormRow>
      </div>
      <FormRow label="备注">
        <Textarea
          value={form.remark}
          onChange={(e) => set("remark", e.target.value)}
          rows={2}
          placeholder="如:双11扩容临时机,12月回收"
          className="text-xs"
        />
      </FormRow>
    </div>
  );
}
