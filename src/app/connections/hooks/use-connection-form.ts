/**
 * /connections/new 与 /connections/[id]/edit 共用的表单 hook:
 * 表单 state、回填(编辑模式)、校验、保存(createConnection/updateConnection)。
 *
 * 成功后由调用方决定跳转(两个 page 路径相同,各自 router.push("/") 即可)。
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createConnection,
  listConnections,
  updateConnection,
} from "@/app/api";
import { isGatewayError } from "@/gateway";
import { useConnectionsStore } from "@/stores/connections";
import { useUiStore } from "@/stores/ui";
import type {
  AuthMethod,
  ConnectionDto,
  ConnectionInput,
  ConnectionNodeDto,
  SecretSaveMode,
} from "@/types";

/** 表单字段。 */
export interface ConnectionFormState {
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
export const EMPTY_FORM: ConnectionFormState = {
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

/** 共享 hook。 */
export function useConnectionForm(opts: { connId?: string }) {
  const isEdit = !!opts.connId;
  const [form, setForm] = useState<ConnectionFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  /** 编辑模式:回填现值。 */
  useEffect(() => {
    if (!opts.connId) return;
    let cancelled = false;
    void listConnections().then((tree) => {
      if (cancelled) return;
      const existing = findConnection(tree, opts.connId!);
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
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [opts.connId]);

  const set = useCallback(
    <K extends keyof ConnectionFormState>(key: K, value: ConnectionFormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  /** 组装请求体;密码/口令留空表示不变更。 */
  const buildInput = useCallback((): ConnectionInput => {
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
  }, [form]);

  /** 保存:校验 → 新建/更新 → 刷新树。 */
  const save = useCallback(async (): Promise<boolean> => {
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      useUiStore.getState().toast("名称、主机、用户名为必填", "error");
      return false;
    }
    setSaving(true);
    try {
      if (opts.connId) {
        await updateConnection(opts.connId, buildInput());
        useUiStore.getState().toast("连接已更新");
      } else {
        await createConnection(buildInput());
        useUiStore.getState().toast("连接已创建");
      }
      await useConnectionsStore.getState().refresh();
      return true;
    } catch (err) {
      useUiStore.getState().toast(
        isGatewayError(err) ? err.message : "保存失败",
        "error",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [opts.connId, buildInput]);

  return { form, set, saving, loading, save };
}
