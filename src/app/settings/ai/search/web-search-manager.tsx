/**
 * 联网搜索管理卡片:状态、密钥输入、保存/测试/清除,与申请密钥的官网链接。
 *
 * 密钥只写不读:后端只回"是否已配置",输入框编辑态留空表示不改动
 * (与模型接入点密钥同一口径)。保存失败展示后端错误原文并保留输入,
 * 不用固定文案吞错(AGENTS.md §4.1.1)。
 */
"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  getWebSearchStatus,
  openExternalUrl,
  saveWebSearchKey,
  testWebSearchKey,
} from "@/app/api";
import { useUiStore } from "@/stores/ui";

/** Tavily 注册入口(免费注册即得密钥,每月 1000 次额度,无需信用卡)。 */
const TAVILY_SIGNUP_URL = "https://app.tavily.com";

/** 页面消息(测试结论或保存失败原文);kind 决定展示样式。 */
type Notice = { kind: "info" | "error"; text: string };

/** 联网搜索管理卡片。 */
export function WebSearchManager() {
  const toast = useUiStore((s) => s.toast);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWebSearchStatus()
      .then((status) => {
        if (!cancelled) setConfigured(status.configured);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setConfigured(false);
          setNotice({
            kind: "error",
            text: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = apiKey.trim();
  const canSave = trimmed.length > 0 && busy === null;
  const canTest =
    busy === null && (trimmed.length > 0 || (configured ?? false));
  const saveBlockReason = !trimmed
    ? configured
      ? "留空表示不改动已保存的密钥"
      : "先填入 Tavily API 密钥才能保存"
    : undefined;

  /** 保存(或清除)密钥;失败保留输入并展示后端原文。 */
  async function onSave() {
    if (!canSave) return;
    setBusy("save");
    setNotice(null);
    try {
      const status = await saveWebSearchKey({ apiKey: trimmed });
      setConfigured(status.configured);
      setApiKey("");
      toast("已保存联网搜索密钥,对话中的助手即可联网搜索");
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  /** 测试连接:优先用本轮填写的密钥,留空回落已存。 */
  async function onTest() {
    if (!canTest) return;
    setBusy("test");
    setNotice(null);
    try {
      const probe = await testWebSearchKey({
        apiKey: trimmed.length > 0 ? trimmed : null,
      });
      setNotice({ kind: probe.ok ? "info" : "error", text: probe.message });
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  /** 清除密钥:助手将失去联网搜索能力(下一轮对话生效)。 */
  async function onClear() {
    setBusy("clear");
    setNotice(null);
    try {
      const status = await saveWebSearchKey({ apiKey: null });
      setConfigured(status.configured);
      setApiKey("");
      toast("已清除联网搜索密钥,助手将无法联网搜索");
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-medium">Tavily 搜索密钥</h2>
        {configured === null ? (
          <Badge variant="outline">正在读取配置…</Badge>
        ) : configured ? (
          <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
            已启用
          </Badge>
        ) : (
          <Badge variant="outline">未配置</Badge>
        )}
      </div>
      <div className="grid gap-3">
        <p className="text-xs text-muted-foreground">
          {configured
            ? "助手对话中已可联网搜索;换密钥直接粘贴覆盖保存。"
            : "配置后,助手对话中会多出「联网搜索」能力(只读取证,无需批准)。"}
        </p>
        <Field>
          <FieldLabel htmlFor="tavily-key">API 密钥</FieldLabel>
          <Input
            id="tavily-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              configured ? "留空表示不改动已保存的密钥" : "tvly- 开头的 Tavily API 密钥"
            }
            autoComplete="new-password"
          />
          <FieldDescription>
            密钥只存系统安全存储,不会写进日志、备份或同步到别处。还没有密钥?
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-sm leading-inherit"
              onClick={() => void openExternalUrl(TAVILY_SIGNUP_URL).catch(() => undefined)}
            >
              前往 Tavily 官网免费注册获取
              <ExternalLink className="ml-1 size-3" aria-hidden />
            </Button>
            (无需信用卡,每月 1000 次免费额度)
          </FieldDescription>
        </Field>
        {notice && (
          <Alert variant={notice.kind === "error" ? "destructive" : "default"}>
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void onSave()}
            disabled={!canSave}
            title={saveBlockReason}
          >
            {busy === "save" ? "保存中…" : "保存密钥"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void onTest()}
            disabled={!canTest}
            title={canTest ? undefined : "先填密钥(或先保存一份)才能测试"}
          >
            {busy === "test" ? "测试中…" : "测试连接"}
          </Button>
          {configured === true && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void onClear()}
              disabled={busy !== null}
              title="清除后助手将无法联网搜索;进行中的对话不受影响"
            >
              {busy === "clear" ? "清除中…" : "清除密钥"}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          测试会真发一次最小搜索(消耗 1 次额度);改动保存后从下一轮对话生效。
        </p>
      </div>
    </section>
  );
}
