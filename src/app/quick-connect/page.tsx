/**
 * /quick-connect — 快速连接(真页面,原 QuickConnectDialog 浮层)。
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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

/** 快速连接页。 */
export default function QuickConnectPage() {
  const router = useRouter();
  const toast = useUiStore((s) => s.toast);
  const [form, setForm] = useState<QuickForm>(EMPTY);
  const [connecting, setConnecting] = useState(false);

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
      toast(`已连接 ${form.host.trim()}`);
      router.push("/");
    } catch (err) {
      toast(isGatewayError(err) ? err.message : "连接失败", "error");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <main className="mx-auto flex h-screen max-w-md flex-col gap-4 overflow-y-auto p-6">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="返回主界面"
          className="rounded-md p-2 hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">快速连接</h1>
        <span className="text-xs text-muted-foreground">不保存为连接记录</span>
      </header>

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
        <Label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
          <Checkbox
            checked={form.save}
            onCheckedChange={(checked) => set("save", checked === true)}
          />
          保存为连接(密码存入钥匙串)
        </Label>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => router.push("/")}>
          取消
        </Button>
        <Button onClick={() => void handleConnect()} disabled={connecting}>
          {connecting ? "连接中…" : "连接"}
        </Button>
      </div>
    </main>
  );
}
