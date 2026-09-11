/**
 * 应用内版本检测 store(AGENTS.md §4.1 表示层职责)。
 *
 * 启动时静默检测一次;优先走 Tauri `check_for_update` 命令(权威),
 * 失败时降级到 GitHub Releases API(便于纯浏览器开发场景)。
 *
 * 设计原则:
 *   - 不阻塞 UI:启动检测在后台,失败静默(不弹 toast)。
 *   - 用户可手动重检(更新弹窗"重新检查"按钮)。
 *   - 图标"染色"由 `status === "available"` 驱动,不展示详细 changelog
 *     (详细说明在弹窗内按需渲染)。
 */
import { create } from "zustand";
import { appMetaApi, fetchLatestRelease, invokeCmd, isTauri } from "@/gateway";
import type { GithubRelease, UpdateInfo } from "@/types";

/** 检测状态机。 */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
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

/**
 * Tauri 命令返回的更新信息。失败或非 Tauri 环境时回落到 GitHub Releases。
 *
 * `available` 是后端已经做了 semver 比较后的结果,前端可直接信赖,
 * 不再二次比较——这是与 GitHub Releases 路径的接口差异(后者需要前端自己比)。
 */
export interface UpdateStore {
  /** 当前应用版本号;启动加载前为 null。 */
  currentVersion: string | null;
  /** Tauri updater 报告的可用更新版本号(去除 `v` 前缀)。 */
  updateVersion: string | null;
  /** Tauri updater 给出的 release notes(Markdown 源)。 */
  notes: string | null;
  /** GitHub Releases 拉到的最新 release(用于发布时间/资源/跳转链接展示)。 */
  latest: GithubRelease | null;
  /** 检测状态机。 */
  status: UpdateStatus;
  /** 最近一次失败消息(便于 UI 展示 / 调试)。 */
  errorMessage: string | null;
  /** 上次成功检测时间戳(用于显示"X 分钟前检查过")。 */
  lastCheckedAt: number | null;

  /** 启动时静默检测一次:加载当前版本 + 走 Tauri 命令(失败降级 GitHub API)。 */
  init(): Promise<void>;
  /** 用户主动重检:跳过缓存,失败要 toast。 */
  checkNow(): Promise<UpdateStatus>;
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  currentVersion: null,
  updateVersion: null,
  notes: null,
  latest: null,
  status: "idle",
  errorMessage: null,
  lastCheckedAt: null,

  async init() {
    if (get().status !== "idle") return;
    // 先加载当前版本(失败也无碍——纯浏览器场景拿不到)。
    try {
      const { version } = await appMetaApi.getAppVersion();
      set({ currentVersion: version });
    } catch {
      /* 静默 */
    }
    await runCheck(set, get, /* silent */ true);
  },

  async checkNow() {
    set({ status: "checking", errorMessage: null });
    return runCheck(set, get, /* silent */ false);
  },
}));

/**
 * 共享检测流程:Tauri 命令优先,失败降级 GitHub API。
 *
 * @param set zustand setState
 * @param get zustand getState
 * @param silent true=启动静默(失败不弹 toast),false=用户主动(失败要弹)
 */
async function runCheck(
  set: (
    partial: Partial<UpdateStore> | ((s: UpdateStore) => Partial<UpdateStore>),
  ) => void,
  get: () => UpdateStore,
  silent: boolean,
): Promise<UpdateStatus> {
  let next: UpdateStatus = "up-to-date";

  // 1) 优先走 Tauri updater 命令
  if (isTauri()) {
    try {
      const info = await invokeCmd<UpdateInfo>("check_for_update");
      if (info.available) {
        set({
          status: "available",
          updateVersion: info.version,
          notes: info.notes ?? null,
          errorMessage: null,
          lastCheckedAt: Date.now(),
        });
        return "available";
      }
      // Tauri 已确认无更新——继续到 GitHub 路径拉 release notes 给 UI 展示。
      next = "up-to-date";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Tauri 命令失败(如离线、endpoint 未配):降级到 GitHub API
      if (!silent) {
        // eslint-disable-next-line no-console
        console.warn("check_for_update 失败,降级到 GitHub API:", message);
      }
    }
  }

  // 2) 降级路径:GitHub Releases API(同时拿到 release notes / 发布时间 / 下载链接)
  try {
    const release = await fetchLatestRelease({ force: !silent });
    const current = get().currentVersion;
    const newer = current ? isNewer(release.tag_name, current) : false;
    next = newer ? "available" : "up-to-date";
    set({
      latest: release,
      status: next,
      updateVersion: newer ? release.tag_name.replace(/^v/, "") : null,
      notes: newer ? release.body || null : null,
      errorMessage: null,
      lastCheckedAt: Date.now(),
    });
    return next;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    set({ status: "error", errorMessage: message });
    return "error";
  }
}
