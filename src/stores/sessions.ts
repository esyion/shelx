/**
 * 会话状态 store(PRD §6.1):由 `session-status-changed` 事件与
 * connect/close 命令结果共同驱动,标签圆点/横幅据此渲染。
 */
import { create } from "zustand";
import type { SessionInfo } from "@/types";

/** 会话 store。 */
export interface SessionsStore {
  /** 会话表(sessionId → 信息)。 */
  byId: Record<string, SessionInfo>;
  /** 批量合并(启动快照 + 命令结果)。 */
  upsertMany(sessions: SessionInfo[]): void;
  /** 合并单条。 */
  upsert(session: SessionInfo): void;
}

export const useSessionsStore = create<SessionsStore>((set) => ({
  byId: {},

  upsertMany(sessions) {
    set((state) => {
      const byId = { ...state.byId };
      for (const session of sessions) {
        byId[session.sessionId] = session;
      }
      return { byId };
    });
  },

  upsert(session) {
    set((state) => ({ byId: { ...state.byId, [session.sessionId]: session } }));
  },
}));
