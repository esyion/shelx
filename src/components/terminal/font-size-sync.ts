/**
 * 终端字号与设置的同步(Ctrl+滚轮缩放,PRD §6.7)。
 *
 * 缩放区间与后端 `application::settings` 的 8–32 校验对齐,避免滚出界后
 * "界面已经变了但保存被拒、重启又跳回旧值"的静默不一致。
 */
"use client";

import { useSettingsStore } from "@/stores/settings";

/** 终端字号可持久化下限(与后端校验一致)。 */
export const FONT_SIZE_MIN = 8;
/** 终端字号可持久化上限(与后端校验一致)。 */
export const FONT_SIZE_MAX = 32;

/** 字号持久化节流句柄。 */
let fontSizePersistTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 把字号写回设置(500ms 节流)。
 *
 * 保存失败时按调用方给出的 `revert` 回滚终端字号并提示后端错误原文。
 *
 * @param fontSize 目标字号
 * @param revert 回滚回调,入参为后端已保存的字号
 */
export function scheduleFontSizePersist(
  fontSize: number,
  revert: (savedFontSize: number) => void,
): void {
  if (fontSizePersistTimer) clearTimeout(fontSizePersistTimer);
  fontSizePersistTimer = setTimeout(() => {
    void useSettingsStore
      .getState()
      .patch({ terminal: { fontSize } })
      .then(async (result) => {
        if (result.ok) return;
        const saved =
          useSettingsStore.getState().settings?.terminal.fontSize ?? 13;
        revert(saved);
        const { useUiStore } = await import("@/stores/ui");
        useUiStore.getState().toast(result.error ?? "字号未能保存", "error");
      });
  }, 500);
}
