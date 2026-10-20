/**
 * 应用内版本检测 store(AGENTS.md §4.1 表示层职责)。
 *
 * 与 transpop 的 `use-app-updater` 等价:
 *   - 启动时静默读取当前版本号,并拉取 Rust 后台已发现的更新通知
 *     (自动检查的调度/重试/设置开关都在 Rust 侧,发现新版本经
 *     `app-update-available` 事件推送 applyNotice,仅驱动图标变蓝);
 *   - 用户主动检查走弹窗(「重新检查」按钮;弹窗打开仅在毫无已知信息时
 *     查一次,其余情况纯展示 store 数据、零网络请求),结果由 UI toast;
 *   - 检查超时由 `@tauri-apps/plugin-updater` 的 `check({ timeout })` 接管,
 *     不在前端再发任何 GitHub fetch,从根本上规避 CSP / 状态机缺口。
 *
 * 状态机: idle → checking → up-to-date | available | error。
 * `finally` 块通过 try/catch/finally 保证状态一定离开 "checking"。
 * 安装流程另有独立状态机 `installPhase`:
 * idle → downloading(百分比经 `installProgress` 暴露)→ installing,
 * 由 `installUpdate` 驱动,失败复位回 idle。
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

/**
 * 安装流程状态机:idle 未在安装 → checking 获取更新句柄(更新来自后台
 * 通知时没有现成的 `Update` 对象,需先静默补查一次)→ downloading 下载中
 * (百分比经 `installProgress` 暴露)→ installing 下载完成等待插件接管
 * 安装重启(桌面端进程随即退出)。
 */
export type InstallPhase = "idle" | "checking" | "downloading" | "installing";

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
  /** 安装流程状态;非 idle 时更新弹窗原位展示进度并禁用操作。 */
  installPhase: InstallPhase;
  /**
   * 下载进度百分比(0–100)。
   * `downloading` 且服务器未返回总大小时为 `null`(不确定进度,UI 显示不定态);
   * `installing` 时恒为 100。
   */
  installProgress: number | null;

  /** 启动时静默读取当前版本号;不做任何网络请求。 */
  init(): Promise<void>;
  /**
   * 写入 Rust 后台自动检查发现的通知(事件推送与 init 拉取共用)。
   * 手动检查或安装流程进行中时忽略,避免事件晚到与本地结果互相抖动。
   */
  applyNotice(notice: UpdateNotice): void;
  /**
   * 用户主动检查。非 Tauri 环境直接返回 `"idle"`,由 UI 自行提示。
   * 成功/失败/超时都会返回对应的 `UpdateStatus`,UI 据此 toast。
   */
  checkNow(): Promise<UpdateStatus>;
  /**
   * 下载并安装更新;成功后调用 `relaunchApp` 重启。
   * 尚无 Update 句柄时(更新来自后台通知)先静默补查一次:补查发现通知
   * 已过期则复位为 up-to-date 并返回 `false`,由 UI 提示;补查到新句柄时
   * 同步刷新版本号与 release notes(远端可能已发布更新的版本)。
   * 下载进度经 `installPhase` / `installProgress` 暴露给 UI。
   * 失败抛 Error 由 UI 捕获 toast,并复位安装状态。
   */
  installUpdate(): Promise<boolean>;
}

export const useUpdateStore = create<UpdateStore>((set, get) => {
  /** 当前持有的 Update 对象(由 `checkForUpdate` 返回,`installUpdate` 消费)。 */
  let updateRef: Update | null = null;
  /** 防止并发点击导致多次检查。 */
  let checking = false;
  /**
   * 防止安装/下载进行中触发新的检查或重复安装
   * (checkNow 会 close 正在下载的 Update 对象)。
   */
  let installing = false;

  return {
    currentVersion: null,
    updateVersion: null,
    notes: null,
    status: "idle",
    errorMessage: null,
    lastCheckedAt: null,
    installPhase: "idle",
    installProgress: null,

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
      // 手动检查或安装进行中不覆盖,避免事件晚到与本地结果互相抖动。
      if (checking || installing) return;
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
      // 安装进行中不允许再检查:checkNow 会 discard 正在下载的 Update 对象。
      if (installing) return get().status;
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
      if (installing) return false;
      installing = true;
      // 先置 checking:后台通知路径没有现成句柄,需静默补查一次再下载。
      set({ installPhase: "checking", installProgress: null });
      try {
        let update = updateRef;
        if (!update) {
          const fresh = await checkForUpdate();
          if (!fresh) {
            // 通知已过期(远端清单已回到当前版本):安装流程结束,
            // 落回 up-to-date 由 UI 提示。
            set({
              status: "up-to-date",
              updateVersion: null,
              notes: null,
              errorMessage: null,
              lastCheckedAt: Date.now(),
              installPhase: "idle",
              installProgress: null,
            });
            return false;
          }
          updateRef = fresh;
          update = fresh;
          // 补查可能拿到比通知更新的版本,同步刷新展示字段。
          set({
            currentVersion: fresh.currentVersion,
            updateVersion: fresh.version,
            notes: fresh.body?.trim() || null,
            errorMessage: null,
            lastCheckedAt: Date.now(),
          });
        }
        set({ installPhase: "downloading", installProgress: null });
        await downloadAndInstallUpdate(update, (percent) => {
          // gateway 约定:NaN 表示服务器未返回总大小,无法计算百分比。
          if (Number.isNaN(percent)) {
            set({ installPhase: "downloading", installProgress: null });
            return;
          }
          // 百分比到 100 即下载完成,之后插件接管安装与应用重启。
          if (percent >= 100) {
            set({ installPhase: "installing", installProgress: 100 });
            return;
          }
          set({ installPhase: "downloading", installProgress: percent });
        });
        await relaunchApp();
        return true;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        // 失败复位安装状态,允许用户重试;桌面端成功路径不会走到这里(进程已重启)。
        set({ installPhase: "idle", installProgress: null });
        throw new Error(`更新安装失败,请稍后重试(${message})`);
      } finally {
        installing = false;
      }
    },
  };
});
