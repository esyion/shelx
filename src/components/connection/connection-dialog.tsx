/**
 * 连接编辑/新建对话框(PRD §6.2 字段表):认证方式联动显隐、
 * 凭据保存方式选择;密码留空 = 保留已存凭据(更新语义)。
 */
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { createConnection, listConnections, updateConnection } from "@/app/api";
import { isGatewayError } from "@/gateway";
import { useUiStore } from "@/stores/ui";
import type {
  AuthMethod,
  ConnectionDto,
  ConnectionInput,
  ConnectionNodeDto,
  SecretSaveMode,
} from "@/types";

/** 表单字段。 */
interface FormState {
  name: string;
  host: string;
  port: string;
  username: string;
  authMethod: AuthMethod;
  password: string;
  passwordSave: SecretSaveMode;
  privateKeyPath: string;
  passphrase: string;
  encoding: "utf-8" | "gbk";
  remark: string;
}

/** 新建默认值(端口/用户名/编码默认来自 PRD §6.2)。 */
const EMPTY_FORM: FormState = {
  name: "",
  host: "",
  port: "22",
  username: "root",
  authMethod: "password",
  password: "",
  passwordSave: "keyring",
  privateKeyPath: "",
  passphrase: "",
  encoding: "utf-8",
  remark: "",
};

/** 从树中找到连接 DTO(编辑回填)。 */
function findConnection(
  nodes: ConnectionNodeDto[],
  connId: string,
): ConnectionDto | null {
  for (const node of nodes) {
    if (node.kind === "group") {
      const hit = findConnection(node.children, connId);
      if (hit) return hit;
    } else if (node.id === connId) {
      return node;
    }
  }
  return null;
}

/**
 * 连接编辑对话框;由 ui store 的 editDialogConnId 驱动
 * (undefined=关闭,null=新建,字符串=编辑)。
 *
 * @param onSaved 保存成功后的回调(刷新树)
 */
export function ConnectionDialog({ onSaved }: { onSaved: () => void }) {
  const editConnId = useUiStore((s) => s.editDialogConnId);
  const closeEditDialog = useUiStore((s) => s.closeEditDialog);
  const toast = useUiStore((s) => s.toast);
  const open = editConnId !== undefined;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // 打开时回填:编辑取现值,新建取默认。
  useEffect(() => {
    if (editConnId === undefined) return;
    if (editConnId === null) {
      setForm(EMPTY_FORM);
      return;
    }
    void listConnections().then((tree) => {
      const existing = findConnection(tree, editConnId);
      if (existing) {
        setForm({
          name: existing.name,
          host: existing.host,
          port: String(existing.port),
          username: existing.username,
          authMethod: existing.authMethod,
          password: "",
          passwordSave: "keyring",
          privateKeyPath: existing.privateKeyPath ?? "",
          passphrase: "",
          encoding: existing.encoding,
          remark: existing.remark ?? "",
        });
      }
    });
  }, [editConnId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /** 组装请求体;密码/口令留空表示不变更。 */
  const buildInput = (): ConnectionInput => {
    const port = Number(form.port);
    const input: ConnectionInput = {
      groupId: null,
      name: form.name.trim(),
      host: form.host.trim(),
      port: Number.isFinite(port) ? port : 22,
      username: form.username.trim(),
      authMethod: form.authMethod,
      privateKeyPath: form.privateKeyPath.trim() || null,
      encoding: form.encoding,
      remark: form.remark.trim() || null,
    };
    if (form.authMethod === "password" && form.password !== "") {
      input.password = { value: form.password, save: form.passwordSave };
    }
    if (form.authMethod === "private_key" && form.passphrase !== "") {
      input.passphrase = { value: form.passphrase, save: form.passwordSave };
    }
    return input;
  };

  /** 保存:本地校验 → 新建/更新 → 关闭并刷新。 */
  const handleSave = async () => {
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      toast("名称、主机、用户名为必填", "error");
      return;
    }
    setSaving(true);
    try {
      if (editConnId) {
        await updateConnection(editConnId, buildInput());
        toast("连接已更新");
      } else {
        await createConnection(buildInput());
        toast("连接已创建");
      }
      closeEditDialog();
      onSaved();
    } catch (err) {
      toast(isGatewayError(err) ? err.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeEditDialog()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editConnId ? "编辑连接" : "新建连接"}</DialogTitle>
        </DialogHeader>
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
              <Field
                label={`密码${editConnId ? "(留空 = 保留已存)" : ""}`}
              >
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
                  onChange={(e) =>
                    set("passwordSave", e.target.value as SecretSaveMode)
                  }
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
              <Field label={`私钥口令${editConnId ? "(留空 = 保留已存)" : ""}`}>
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
                onChange={(e) =>
                  set("encoding", e.target.value as "utf-8" | "gbk")
                }
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
        <DialogFooter>
          <Button variant="outline" onClick={closeEditDialog}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 带标签的表单行。 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
