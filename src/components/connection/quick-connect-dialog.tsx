/**
 * 快速连接弹窗(PRD §6.2):临时输入直连,不保存配置;
 * 可选"保存为连接"(密码将入钥匙串)。
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { connectQuickSession } from "@/app/api";
import { isGatewayError } from "@/gateway";
import { useSessionsStore } from "@/stores/sessions";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import type { AuthMethod } from "@/types";

/** 表单状态。 */
interface QuickForm {
  host: string;
  port: string;
  username: string;
  authMethod: AuthMethod;
  password: string;
  save: boolean;
}

/** 默认值。 */
const EMPTY: QuickForm = {
  host: "",
  port: "22",
  username: "root",
  authMethod: "password",
  password: "",
  save: false,
};

/** 快速连接对话框;由 ui store 的 quickConnectOpen 驱动。 */
export function QuickConnectDialog() {
  const open = useUiStore((s) => s.quickConnectOpen);
  const setOpen = useUiStore((s) => s.setQuickConnectOpen);
  const toast = useUiStore((s) => s.toast);
  const [form, setForm] = useState<QuickForm>(EMPTY);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (open) setForm(EMPTY);
  }, [open]);

  const set = <K extends keyof QuickForm>(key: K, value: QuickForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /** 直连:成功开临时标签;失败提示。 */
  const handleConnect = async () => {
    if (!form.host.trim() || !form.username.trim()) {
      toast("主机与用户名为必填", "error");
      return;
    }
    const port = Number(form.port);
    setConnecting(true);
    try {
      const session = await connectQuickSession({
        host: form.host.trim(),
        port: Number.isFinite(port) && port > 0 ? port : 22,
        username: form.username.trim(),
        authMethod: form.authMethod,
        password: form.password || null,
        save: form.save,
      });
      useSessionsStore.getState().upsert(session);
      useTabsStore.getState().openConnectionTab({
        sessionId: session.sessionId,
        connId: session.connId,
        title: form.host.trim(),
        temporary: !form.save,
      });
      setOpen(false);
      toast(`已连接 ${form.host.trim()}`);
    } catch (err) {
      toast(isGatewayError(err) ? err.message : "连接失败", "error");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>快速连接</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">主机 *</Label>
              <Input
                value={form.host}
                onChange={(e) => set("host", e.target.value)}
                placeholder="IP 或域名"
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">端口</Label>
              <Input
                value={form.port}
                onChange={(e) => set("port", e.target.value)}
                inputMode="numeric"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">用户名 *</Label>
              <Input
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">认证方式</Label>
              <NativeSelect
                value={form.authMethod}
                onChange={(e) => set("authMethod", e.target.value as AuthMethod)}
              >
                <option value="password">密码</option>
                <option value="private_key">私钥</option>
                <option value="keyboard_interactive">键盘交互</option>
                <option value="agent">免密</option>
              </NativeSelect>
            </div>
          </div>
          {form.authMethod === "password" && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">密码</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                autoComplete="new-password"
              />
            </div>
          )}
          <Label className="text-xs font-normal text-muted-foreground">
            <Checkbox
              checked={form.save}
              onCheckedChange={(checked) => set("save", checked === true)}
            />
            保存为连接(密码存入钥匙串)
          </Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={() => void handleConnect()} disabled={connecting}>
            {connecting ? "连接中…" : "连接"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
