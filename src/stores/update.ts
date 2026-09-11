/**
 * 应用内版本检测 store(AGENTS.md §4.1 表示层职责):
 * 启动时静默拉取一次 GitHub Releases,有新版时把图标"染色"。
 *
 * 设计原则:
 *   - 不阻塞 UI:启动检测在后台,失败静默(不弹 toast)。
 *   - 用户可手动重检(设置页 / 弹窗"重新检查"按钮)。
 *   - 当前版本与最新版本比较,只关心"是否可更新",不展示详细 changelog
 *     (详细说明在弹窗内按需渲染 release.body 的前若干行)。
 */
import { create } from "zustand";
import { appMetaApi, fetchLatestRelease } from "@/gateway";
import type { GithubRelease } from "@/types";

/** 检测状态机。 */
export type UpdateStatus =
  /** 尚未启动任何检测。 */
  | "idle"
  /** 正在拉取(用户主动重检)。 */
  | "checking"
  /** 已完成,远端无新版本或当前已是最新。 */
  | "up-to-date"
  /** 已完成,有新版本。 */
  | "available"
  /** 拉取失败(网络/限流/仓库不存在)。 */
  | "error";

/** 去前缀的 semver 比较:"v0.2.0" / "0.2.0" -> 数字三元组。 */
function parseSemver(raw: string): [number, number, number] | null {
  const trimmed = raw.replace(/^v/i, "").trim();
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(trimmed);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** 严格大于。预发布版本视为小于其正式版(用户已同意此简化策略)。 */
export function isNewer(latest: string, current: string): boolean {
  const l = parseSemver(latest);
  const c = parseSemver(current);
  if (!l || !c) return false;
  for (let i = 0; i < 3; i++) {
    if (l[i] > c[i]) return true;
    if (l[i] < c[i]) return false;
  }
  return false;
}

/** 更新检测 store。 */
export interface UpdateStore {
  /** 当前应用版本号;启动加载前为 null。 */
  currentVersion: string | null;
  /** 远端最新 release;成功检测后填充。 */
  latest: GithubRelease | null;
  /** 检测状态机。 */
  status: UpdateStatus;
  /** 最近一次失败消息(便于 UI 展示 / 调试)。 */
  errorMessage: string | null;
  /** 上次成功检测时间戳(用于显示"X 分钟前检查过")。 */
  lastCheckedAt: number | null;

  /** 启动时静默检测一次:加载当前版本 + 拉取 latest(忽略错误)。 */
  init(): Promise<void>;
  /** 用户主动重检:跳过 release gateway 缓存,失败要 toast。 */
  checkNow(): Promise<UpdateStatus>;
  /** 清空错误状态(弹窗关闭时调用)。 */
  dismissError(): void;
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  currentVersion: null,
  latest: null,
  status: "idle",
  errorMessage: null,
  lastCheckedAt: null,

  async init() {
    if (get().status !== "idle") return;
    try {
      const { version } = await appMetaApi.getAppVersion();
      set({ currentVersion: version });
    } catch {
      // Tauri 环境外(纯浏览器调试)拿不到版本,不阻断后续检测。
    }
    try {
      const release = await fetchLatestRelease();
      const current = get().currentVersion;
      const newer = current ? isNewer(release.tag_name, current) : false;
      set({
        latest: release,
        status: newer ? "available" : "up-to-date",
        errorMessage: null,
        lastCheckedAt: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "未知错误";
      set({ status: "error", errorMessage: message });
    }
  },

  async checkNow() {
    set({ status: "checking", errorMessage: null });
    try {
      const release = await fetchLatestRelease({ force: true });
      const current = get().currentVersion;
      const newer = current ? isNewer(release.tag_name, current) : false;
      const next: UpdateStatus = newer ? "available" : "up-to-date";
      set({
        latest: release,
        status: next,
        errorMessage: null,
        lastCheckedAt: Date.now(),
      });
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : "未知错误";
      set({ status: "error", errorMessage: message });
      return "error";
    }
  },

  dismissError() {
    set({ errorMessage: null });
  },
}));
