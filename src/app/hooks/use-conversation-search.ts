/**
 * 对话语义搜索 hook:离线索引状态轮询 + 搜索动作(搜索弹窗与入口共用)。
 *
 * 状态轮询只在「准备中」持续进行;搜索失败保留后端错误原文,不吞错(§6)。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationHitDto, SemanticStatusDto } from "@/types";
import * as api from "@/app/api";

/** 准备中的轮询间隔(下载模型与回填是后台任务,这里只做轻量状态查询)。 */
const PREPARING_POLL_MS = 1500;

/**
 * 管理语义索引状态与搜索结果。
 *
 * @param active 打开的弹窗等宿主是否活跃(活跃才轮询,关闭即停)。
 */
export function useConversationSearch(active: boolean) {
  const [status, setStatus] = useState<SemanticStatusDto | null>(null);
  const [hits, setHits] = useState<ConversationHitDto[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.semanticStatus());
    } catch (err) {
      // 状态查询失败不吞:界面要能看见原因,但不阻断弹窗其余部分。
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    alive.current = active;
    if (active) void refreshStatus();
    return () => {
      alive.current = false;
    };
  }, [active, refreshStatus]);

  /** 准备中持续轮询,直到终态或宿主关闭。 */
  useEffect(() => {
    if (!active || status?.state !== "preparing") return;
    const timer = setInterval(() => {
      if (alive.current) void refreshStatus();
    }, PREPARING_POLL_MS);
    return () => clearInterval(timer);
  }, [active, status?.state, refreshStatus]);

  /** 发起准备(下载离线模型并整理历史);立即返回,进度交给轮询。 */
  const prepare = useCallback(async () => {
    setError(null);
    try {
      await api.prepareSemanticIndex();
      setStatus({ state: "preparing", message: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** 按意思搜索历史对话;结果为 null 表示「还没搜过」。 */
  const search = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed || searching) return;
    setSearching(true);
    setError(null);
    try {
      setHits(await api.searchConversations({ query: trimmed }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }, [searching]);

  /** 关闭弹窗时清掉结果,下次打开从状态页开始。 */
  const reset = useCallback(() => {
    setHits(null);
    setError(null);
  }, []);

  return { status, hits, searching, error, prepare, search, refreshStatus, reset };
}
