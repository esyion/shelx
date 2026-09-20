/**
 * 应用内版本检测 store(AGENTS.md §4.1 表示层职责)。
 *
 * 与 transpop 的 `use-app-updater` 等价:
 *   - 启动时静默读取当前版本号,并拉取 Rust 后台已发现的更新通知
 *     (自动检查的调度/重试/设置开关都在 Rust 侧,发现新版本经
 *     `app-update-available` 事件推送 applyNotice,仅驱动图标变蓝);
 *   - 用户主动检查走弹窗(打开即查/「重新检查」按钮),结果由 UI toast;
 *   - 检查超时由 `@tauri-apps/plugin-updater` 的 `check({ timeout })` 接管,
 *     不在前端再发任何 GitHub fetch,从根本上规避 CSP / 状态机缺口。
 *
 * 状态机: idle → checking → up-to-date | available | error。
 * `finally` 块通过 try/catch/finally 保证状态一定离开 "checking"。
 *
 * 设计取舍:本 store 不持有 toast 能力,失败结果通过返回值交给 UI 层
 * 统一 toast(与 `useUiStore.toast` 风格一致),避免在领域 store 里
 * 耦合 UI 实现。
 */
import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";

import { isTauri } from "@/gateway";
import {
  checkForUpdate,
  discardUpdate,
  downloadAndInstallUpdate,
  getCurrentVersion,
  getUpdateNotice,
  relaunchApp,
} from "@/gateway";
import type { UpdateNotice } from "@/types";

/** 检测状态机。 */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "error";

export interface UpdateStore {
  /** 当前应用版本号;启动加载前为 null。 */
  currentVersion: string | null;
  /** Tauri updater 报告的可用更新版本号(去除 `v` 前缀)。 */
  updateVersion: string | null;
  /** release notes(Markdown 源);无更新或插件未返回时为 null。 */
  notes: string | null;
  /** 检测状态机。 */
  status: UpdateStatus;
  /** 最近一次失败消息(便于 UI 展示 / 调试)。 */
  errorMessage: string | null;
  /** 上次成功检测时间戳(用于显示"X 分钟前检查过")。 */
  lastCheckedAt: number | null;

  /** 启动时静默读取当前版本号;不做任何网络请求。 */
  init(): Promise<void>;
  /**
   * 写入 Rust 后台自动检查发现的通知(事件推送与 init 拉取共用)。
   * 手动检查进行中时忽略,以手动检查的结果为准。
   */
  applyNotice(notice: UpdateNotice): void;
  /**
   * 用户主动检查。非 Tauri 环境直接返回 `"idle"`,由 UI 自行提示。
   * 成功/失败/超时都会返回对应的 `UpdateStatus`,UI 据此 toast。
   */
  checkNow(): Promise<UpdateStatus>;
  /**
   * 下载并安装更新;成功后调用 `relaunchApp` 重启。
   * 失败抛 Error 由 UI 捕获 toast;无更新对象时返回 `false`。
   */
  installUpdate(): Promise<boolean>;
}

export const useUpdateStore = create<UpdateStore>((set, get) => {
  /** 当前持有的 Update 对象(由 `checkForUpdate` 返回,`installUpdate` 消费)。 */
  let updateRef: Update | null = null;
  /** 防止并发点击导致多次检查。 */
  let checking = false;

  return {
    currentVersion: null,
    updateVersion: null,
    notes: null,
    status: "idle",
    errorMessage: null,
    lastCheckedAt: null,

    async init() {
      if (!isTauri()) return;
      if (get().currentVersion !== null) return;
      try {
        const version = await getCurrentVersion();
        set({ currentVersion: version });
      } catch {
        /* 静默:启动期读不到版本不影响后续检查 */
      }
      // 拉取后台已发现的通知(webview 刷新后恢复侧栏图标状态);
      // 尚未检查过或读取失败都静默降级为灰色图标。
      try {
        const notice = await getUpdateNotice();
        if (notice) get().applyNotice(notice);
      } catch {
        /* 静默 */
      }
    },

    applyNotice(notice) {
      // 手动检查进行中时不覆盖,避免事件晚到与手动结果互相抖动。
      if (checking) return;
      set({
        currentVersion: notice.currentVersion,
        updateVersion: notice.version,
        notes: notice.notes,
        status: "available",
        errorMessage: null,
        lastCheckedAt: notice.checkedAtMs,
      });
    },

    async checkNow() {
      if (!isTauri()) return "idle" as UpdateStatus;
      if (checking) return get().status;
      checking = true;
      set({ status: "checking", errorMessage: null });

      try {
        await discardUpdate(updateRef);
        updateRef = null;

        const update = await checkForUpdate();
        updateRef = update;

        if (!update) {
          set({
            status: "up-to-date",
            updateVersion: null,
            notes: null,
            errorMessage: null,
            lastCheckedAt: Date.now(),
          });
          return "up-to-date";
        }

        set({
          currentVersion: update.currentVersion,
          updateVersion: update.version,
          notes: update.body?.trim() || null,
          status: "available",
          errorMessage: null,
          lastCheckedAt: Date.now(),
        });
        return "available";
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        set({
          status: "error",
          errorMessage: message,
          lastCheckedAt: Date.now(),
        });
        return "error";
      } finally {
        checking = false;
      }
    },

    async installUpdate() {
      const update = updateRef;
      if (!update) return false;
      try {
        await downloadAndInstallUpdate(update, () => {
          /* 进度事件:本次重构不展示进度条,后续如需展示可在此处 patch state */
        });
        await relaunchApp();
        return true;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`更新安装失败,请稍后重试(${message})`);
      }
    },
  };
});
