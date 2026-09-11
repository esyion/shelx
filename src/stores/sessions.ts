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
  /** 每次会话回到 online 的计数(重连后终端视图据此重开 pty 通道)。 */
  onlineEpoch: Record<string, number>;
  /** 批量合并(启动快照 + 命令结果)。 */
  upsertMany(sessions: SessionInfo[]): void;
  /** 合并单条;回到 online 时递增 epoch。 */
  upsert(session: SessionInfo): void;
}

export const useSessionsStore = create<SessionsStore>((set) => ({
  byId: {},
  onlineEpoch: {},

  upsertMany(sessions) {
    set((state) => {
      const byId = { ...state.byId };
      const onlineEpoch = { ...state.onlineEpoch };
      for (const session of sessions) {
        if (session.status === "online" && byId[session.sessionId]?.status !== "online") {
          onlineEpoch[session.sessionId] = (onlineEpoch[session.sessionId] ?? 0) + 1;
        }
        byId[session.sessionId] = session;
      }
      return { byId, onlineEpoch };
    });
  },

  upsert(session) {
    set((state) => {
      const wasOnline = state.byId[session.sessionId]?.status === "online";
      const onlineEpoch = { ...state.onlineEpoch };
      if (session.status === "online" && !wasOnline) {
        onlineEpoch[session.sessionId] = (onlineEpoch[session.sessionId] ?? 0) + 1;
      }
      return {
        byId: { ...state.byId, [session.sessionId]: session },
        onlineEpoch,
      };
    });
  },
}));
