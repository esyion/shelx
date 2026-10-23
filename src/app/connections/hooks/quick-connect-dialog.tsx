/**
 * 快速连接对话框:不预先建连接记录,直接临时连一台服务器(PRD §6.2)。
 *
 * 后端 `connect_quick_session` 能力早已就绪但界面没有入口,这里补上:
 * - 最少字段:主机 / 端口 / 用户名 / 认证方式 / 密码(私钥登录时复用
 *   PrivateKeyField 选择本机密钥);
 * - `save:false` 开临时会话(标签带"临时"徽标),勾选"保存为连接"时
 *   `save:true` 落库(后端语义:密码/口令入系统凭据库);
 * - 成功后用返回的 SessionInfo(connId/temporary 由后端决定)开标签;
 * - 失败展示后端可读原因,已输入内容全部保留;
 * - 主机指纹确认与 OTP 由全局弹窗宿主处理,这里不重复实现。
 */
"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { connectQuickSession } from "@/app/api";
import { isGatewayError } from "@/gateway";
import { useConnectionsStore } from "@/stores/connections";
import { useSessionsStore } from "@/stores/sessions";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import type { AuthMethod } from "@/types";
import { AUTH_METHOD_OPTIONS } from "@/lib/connection-options";
import { PrivateKeyField } from "./private-key-field";

/** 快速连接表单最小状态。 */
interface QuickForm {
  host: string;
  port: string;
  username: string;
  authMethod: AuthMethod;
  password: string;
  privateKeyPath: string;
  saveAsConnection: boolean;
}

const EMPTY: QuickForm = {
  host: "",
  port: "22",
  username: "root",
  authMethod: "password",
  password: "",
  privateKeyPath: "",
  saveAsConnection: false,
};

/** 校验快速连接输入,返回错误文案(null = 通过)。 */
function validate(form: QuickForm): string | null {
  if (!form.host.trim()) return "请填写服务器地址(IP 或域名)";
  if (!form.username.trim()) return "请填写登录用户名";
  const port = Number(form.port.trim());
  if (!/^\d{1,5}$/.test(form.port.trim()) || port < 1 || port > 65535) {
    return "端口需为 1-65535 的整数(SSH 默认是 22)";
  }
  if (form.authMethod === "password" && form.password === "") {
    return "请填写密码(临时连接不会保存它)";
  }
  return null;
}

/** QuickConnectDialog props。 */
export interface QuickConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ssh:// 深链预填;对话框打开且存在时覆盖主机/端口/用户名(用户名缺省沿用表单默认)。 */
  prefill?: QuickLinkPrefill | null;
}

/** 深链预填目标(与 stores/ui 的 QuickLink 形状一致,解耦 store 类型)。 */
export interface QuickLinkPrefill {
  /** 主机(IP 或域名)。 */
  host: string;
  /** 用户名;null 沿用表单默认。 */
  username: string | null;
  /** 端口。 */
  port: number;
}

/** 快速连接对话框。 */
export function QuickConnectDialog({
  open,
  onOpenChange,
  prefill = null,
}: QuickConnectDialogProps) {
  const [form, setForm] = useState<QuickForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 深链预填:仅在对话框打开且带着预填目标时覆盖对应字段,
  // 用户手工清空/修改不被后续渲染覆盖(effect 只在依赖变化时执行一次)。
  useEffect(() => {
    if (!open || !prefill) return;
    setForm((prev) => ({
      ...prev,
      host: prefill.host,
      port: String(prefill.port),
      username: prefill.username?.trim() ? prefill.username : prev.username,
    }));
  }, [open, prefill]);

  /** 更新单字段(保持受控)。 */
  const set = <K extends keyof QuickForm>(key: K, value: QuickForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  /** 关闭时清空一次性凭据,避免密码滞留。 */
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setForm(EMPTY);
      setError(null);
    }
    onOpenChange(next);
  };

  /** 发起连接:校验 → connectQuickSession → 开标签(临时或已落库)。 */
  const onConnect = async () => {
    if (busy) return;
    const message = validate(form);
    if (message) {
      setError(message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await connectQuickSession({
        name: null,
        host: form.host.trim(),
        port: Number(form.port.trim()),
        username: form.username.trim(),
        authMethod: form.authMethod,
        password: form.authMethod === "password" ? form.password : null,
        // 快速连接不收私钥口令(契约字段显式为 null,避免"省略即保持"的歧义)。
        passphrase: null,
        privateKeyPath:
          form.authMethod === "private_key" && form.privateKeyPath.trim() !== ""
            ? form.privateKeyPath.trim()
            : null,
        save: form.saveAsConnection,
      });
      useSessionsStore.getState().upsert(session);
      useTabsStore.getState().openConnectionTab({
        sessionId: session.sessionId,
        connId: session.connId,
        title: `${form.username.trim()}@${form.host.trim()}`,
        temporary: session.temporary,
      });
      if (form.saveAsConnection) {
        await useConnectionsStore.getState().refresh();
      }
      useUiStore.getState().toast("已连接");
      handleOpenChange(false);
    } catch (err) {
      // 失败保留全部已输入内容;若后端已建会话但后续失败,顺手释放防野会话。
      setError(
        isGatewayError(err)
          ? `连接失败:${err.message}`
          : "连接失败:发生未知错误,请检查网络或配置",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>快速连接</DialogTitle>
          <DialogDescription>
            临时连一台服务器,不用先建连接;需要常用时勾选"保存为连接"。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <label htmlFor="quick-host" className="text-xs text-muted-foreground">
              主机 *
            </label>
            <Input
              id="quick-host"
              value={form.host}
              onChange={(e) => set("host", e.target.value)}
              placeholder="IP 或域名"
              className="text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="quick-port" className="text-xs text-muted-foreground">
                端口
              </label>
              <Input
                id="quick-port"
                value={form.port}
                onChange={(e) => set("port", e.target.value)}
                inputMode="numeric"
                className="text-xs"
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="quick-user" className="text-xs text-muted-foreground">
                用户名 *
              </label>
              <Input
                id="quick-user"
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
                className="text-xs"
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="quick-auth" className="text-xs text-muted-foreground">
              怎么登录服务器?
            </label>
            <NativeSelect
              id="quick-auth"
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
            <p className="text-xs text-muted-foreground">
              {AUTH_METHOD_OPTIONS.find((o) => o.value === form.authMethod)?.hint}
            </p>
          </div>
          {form.authMethod === "password" && (
            <div className="grid gap-1.5">
              <label htmlFor="quick-password" className="text-xs text-muted-foreground">
                密码 *
              </label>
              <Input
                id="quick-password"
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                autoComplete="new-password"
                className="text-xs"
              />
            </div>
          )}
          {form.authMethod === "private_key" && (
            <div className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">私钥文件</span>
              <PrivateKeyField
                value={form.privateKeyPath}
                onChange={(path) => set("privateKeyPath", path)}
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={form.saveAsConnection}
              onCheckedChange={(checked) =>
                set("saveAsConnection", checked === true)
              }
            />
            保存为连接(密码将存入系统凭据库,下次不用重输)
          </label>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void onConnect()} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                连接中…
              </>
            ) : (
              "连接"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
