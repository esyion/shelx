/**
 * /connections/new 与 /connections/edit 共用的表单 hook:
 * 表单 state、回填(编辑模式)、字段级校验、保存(createConnection/updateConnection)。
 *
 * 校验策略(产品硬规则:事前拦、行内提示,不聚合 toast):
 * - 提交/测试前跑 `validateConnectionForm`,不合法就不发请求;
 * - 提交过一次后,输入变化实时重新校验并消除对应行内错误;
 * - 提交被拦时聚焦第一个错误控件(见 CONNECTION_FIELD_IDS)。
 *
 * 成功后由调用方决定跳转(ConnectionFormPage 统一 router.push("/"))。
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
import { useSettingsStore } from "@/stores/settings";
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

/** 新建默认值(端口/用户名/编码默认来自 PRD §6.2;认证方式默认读设置)。 */
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

/** 需要行内错误提示的必填/格式字段。 */
export type ConnectionFieldKey = "name" | "host" | "port" | "username";

/** 各字段的表单错误映射。 */
export type ConnectionFormErrors = Partial<
  Record<ConnectionFieldKey, string>
>;

/** 字段 → 控件 DOM id:用于提交被拦时聚焦第一个错误控件。 */
export const CONNECTION_FIELD_IDS: Record<ConnectionFieldKey, string> = {
  name: "conn-field-name",
  host: "conn-field-host",
  port: "conn-field-port",
  username: "conn-field-username",
};

/** 聚焦顺序(按界面从上到下)。 */
const FIELD_FOCUS_ORDER: ConnectionFieldKey[] = [
  "name",
  "host",
  "port",
  "username",
];

/**
 * 校验整个表单,返回字段 → 错误文案。
 *
 * 规则与 Rust `ConnConfig::new` 的领域不变量对齐(名称/主机/用户名非空白,
 * 端口合法),并补足前端体验:端口必须是 1-65535 的整数,不再静默回落 22。
 */
export function validateConnectionForm(
  form: ConnectionFormState,
): ConnectionFormErrors {
  const errors: ConnectionFormErrors = {};
  if (!form.name.trim()) {
    errors.name = "请填写名称,方便你在列表里认出这台服务器";
  }
  if (!form.host.trim()) {
    errors.host = "请填写服务器地址(IP 或域名)";
  }
  if (!form.username.trim()) {
    errors.username = "请填写登录用户名";
  }
  const portText = form.port.trim();
  if (!/^\d{1,5}$/.test(portText)) {
    errors.port = "端口需为 1-65535 的整数(SSH 默认是 22)";
  } else {
    const port = Number(portText);
    if (port < 1 || port > 65535) {
      errors.port = "端口需在 1-65535 之间(SSH 默认是 22)";
    }
  }
  return errors;
}

/** 聚焦第一个错误控件(等 React 渲染出行内错误后再聚焦)。 */
function focusFirstError(errors: ConnectionFormErrors): void {
  const first = FIELD_FOCUS_ORDER.find((key) => errors[key]);
  if (!first) return;
  requestAnimationFrame(() => {
    document.getElementById(CONNECTION_FIELD_IDS[first])?.focus();
  });
}

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
  const defaultAuth = useSettingsStore((s) => s.settings?.connection.defaultAuthMethod);
  const [form, setForm] = useState<ConnectionFormState>(() => ({
    ...EMPTY_FORM,
    // 设置里用户改的默认认证方式在这里真正生效;store 未加载时回退密码。
    authMethod: defaultAuth ?? EMPTY_FORM.authMethod,
  }));
  const [errors, setErrors] = useState<ConnectionFormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [authTouched, setAuthTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [missing, setMissing] = useState(false);

  /** 新建模式:设置晚到(启动异步加载)时补应用默认认证方式,用户改过则不覆盖。 */
  useEffect(() => {
    if (isEdit || authTouched || !defaultAuth) return;
    setForm((prev) =>
      prev.authMethod === defaultAuth ? prev : { ...prev, authMethod: defaultAuth },
    );
  }, [defaultAuth, isEdit, authTouched]);

  /** 编辑模式:回填现值;加载失败/记录不存在置 missing,由页面呈现而不是静默。 */
  useEffect(() => {
    if (!opts.connId) return;
    let cancelled = false;
    void listConnections()
      .then((tree) => {
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
        } else {
          setMissing(true);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMissing(true);
        setLoading(false);
        useUiStore.getState().toast(
          isGatewayError(err) ? err.message : "连接信息加载失败",
          "error",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [opts.connId]);

  /** 提交过一次后,输入变化实时重校验,行内错误随修正即时消失。 */
  useEffect(() => {
    if (submitted) setErrors(validateConnectionForm(form));
  }, [submitted, form]);

  const set = useCallback(
    <K extends keyof ConnectionFormState>(key: K, value: ConnectionFormState[K]) => {
      if (key === "authMethod") setAuthTouched(true);
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  /** 组装请求体;密码/口令留空表示不变更(null 即显式不变更);端口已在提交前显式校验。 */
  const buildInput = useCallback((): ConnectionInput => {
    const input: ConnectionInput = {
      groupId: null,
      name: form.name.trim(),
      host: form.host.trim(),
      port: Number(form.port.trim()),
      username: form.username.trim(),
      authMethod: form.authMethod,
      privateKeyPath: form.privateKeyPath.trim() || null,
      encoding: form.encoding,
      remark: form.remark.trim() || null,
      tagColor: null,
      password: null,
      passphrase: null,
    };
    if (form.authMethod === "password" && form.password !== "") {
      input.password = { value: form.password, save: form.passwordSave };
    }
    if (form.authMethod === "private_key" && form.passphrase !== "") {
      input.passphrase = { value: form.passphrase, save: form.passwordSave };
    }
    return input;
  }, [form]);

  /** 显式校验(供"测试连接"等入口事前拦截);失败聚焦第一个错误控件。 */
  const validate = useCallback((): boolean => {
    setSubmitted(true);
    const nextErrors = validateConnectionForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstError(nextErrors);
      return false;
    }
    return true;
  }, [form]);

  /** 保存:先字段级校验(不合法不发请求),再新建/更新并刷新树。 */
  const save = useCallback(async (): Promise<boolean> => {
    if (!validate()) return false;
    if (missing) return false;
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
      // 失败保留全部已输入内容,用户修正后可直接重试。
      useUiStore.getState().toast(
        isGatewayError(err) ? err.message : "保存失败",
        "error",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [opts.connId, buildInput, validate, missing]);

  return { form, set, saving, loading, errors, missing, save, validate };
}
