/**
 * "测试连接" hook:填错密码/私钥不必先保存再双击连接。
 *
 * 复用现有 IPC 契约 `connectQuickSession`(save:false = 不落库、不建连接记录),
 * 按当前表单输入建一次性临时会话验证"主机可达 + 认证正确",
 * 成功后立即 `closeSession` 释放,避免留下野会话;
 * 失败展示后端返回的可读原因(isGatewayError),绝不回显密码,
 * 且保留用户已输入的全部内容,修正后可直接重试。
 */
"use client";

import { useCallback, useRef, useState } from "react";
import { closeSession, connectQuickSession } from "@/app/api";
import { isGatewayError } from "@/gateway";
import type { ConnectionFormState } from "./use-connection-form";

/** 测试结果(展示在表单底部)。 */
export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

/** 测试连接状态。 */
export interface ConnectionTestState {
  /** 请求进行中(按钮 loading,禁止重复点击)。 */
  testing: boolean;
  /** 最近一次测试结论;null = 尚未测试。 */
  result: ConnectionTestResult | null;
  /** 发起测试(调用方需先跑表单字段级校验)。 */
  run: (form: ConnectionFormState) => Promise<void>;
}

/** 测试连接 hook。 */
export function useConnectionTest(): ConnectionTestState {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  /** ref 防抖:避免 state 未更新时的连点重复建会话。 */
  const runningRef = useRef(false);

  const run = useCallback(async (form: ConnectionFormState) => {
    if (runningRef.current) return;
    // 事前拦截:密码登录但还没填密码时,直接给出提示而不是等后端报"缺少凭据"。
    if (form.authMethod === "password" && form.password === "") {
      setResult({
        ok: false,
        message: "请先在上方输入要测试的密码(测试不会保存密码)",
      });
      return;
    }
    runningRef.current = true;
    setTesting(true);
    setResult(null);
    try {
      const session = await connectQuickSession({
        name: null,
        host: form.host.trim(),
        port: Number(form.port.trim()),
        username: form.username.trim(),
        authMethod: form.authMethod,
        password: form.authMethod === "password" ? form.password : null,
        passphrase:
          form.authMethod === "private_key" && form.passphrase !== ""
            ? form.passphrase
            : null,
        privateKeyPath:
          form.authMethod === "private_key" && form.privateKeyPath.trim() !== ""
            ? form.privateKeyPath.trim()
            : null,
        save: false,
      });
      try {
        await closeSession(session.sessionId);
      } catch {
        // 关闭失败不影响"可达且认证通过"的结论;后端状态事件会收敛会话。
      }
      setResult({
        ok: true,
        message: "连接成功:服务器可达、登录信息正确(测试用的临时会话已自动关闭)",
      });
    } catch (err) {
      setResult({
        ok: false,
        message: isGatewayError(err)
          ? `连接失败:${err.message}`
          : "连接失败:发生未知错误,请检查网络或配置后重试",
      });
    } finally {
      runningRef.current = false;
      setTesting(false);
    }
  }, []);

  return { testing, result, run };
}
