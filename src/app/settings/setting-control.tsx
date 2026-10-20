/**
 * 单个设置项控件:控件形态只由后端契约的 `kind` 决定。
 *
 * - `int` / `float` → 契约 `presets` 档位下拉,标签由 unit + 值 + 默认值组装;
 * - `enum` → 契约 `options` 下拉,中文标签来自文案表(缺失则回退显示原值);
 * - `bool` → 开关;
 * - `text` → 文案表登记的候选下拉(字体栈等 UI 资产),无候选时退化为自由输入。
 *
 * 本组件不出现任何后端字段名:路径由上层按契约传入,提交前做与后端同区间的
 * 本地校验,失败时保留用户刚选的值并把错误定位到本行(AGENTS.md §4.1.1)。
 */
"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { SettingPath, SettingSpec, SettingViolation } from "@/types";
import type { SettingsSaveResult } from "@/stores/settings";
import { Row, SwitchRow } from "./form-controls";
import type { SettingCopy } from "./settings-copy";
import {
  localViolation,
  settingChoices,
  valueLabel,
  violationText,
} from "./setting-value";

/** 可提交值(契约数值项保持数值,其余为字符串/布尔)。 */
export type SettingValue = string | number | boolean;

/** 设置项控件属性。 */
export interface SettingControlProps {
  /** 后端契约项(区间、档位、候选值、单位、默认值)。 */
  spec: SettingSpec;
  /** 表现层文案。 */
  copy: SettingCopy;
  /** 当前已保存值。 */
  value: unknown;
  /** 保存回调:路径来自契约,由上层转交 store。 */
  onSave: (
    path: SettingPath,
    value: SettingValue,
  ) => Promise<SettingsSaveResult>;
  /** 保存成功后的表现层副作用(如主题切换)。 */
  onSaved?: (value: SettingValue) => void;
}

/** 保存失败态:保留用户刚选的值,避免后端回滚后输入凭空消失。 */
interface SaveFailure {
  /** 用户刚选但未落库的值。 */
  value: SettingValue;
  /** 行内错误文案(含区间/单位或后端原文)。 */
  message: string;
}

/**
 * 把保存结果翻译为行内错误文案。
 *
 * 优先用契约区间 + 单位 + 中文标签本地组装;拿不到违规详情时展示后端错误原文;
 * 两者都缺失才使用兜底说明,绝不假装保存成功。
 *
 * @param savedValue 后端当前已保存值(用于说明「当前仍是 X」)
 */
function failureMessage(
  spec: SettingSpec,
  copy: SettingCopy,
  attempted: SettingValue,
  result: SettingsSaveResult,
  savedValue: unknown,
): string {
  const violation: SettingViolation | null =
    result.violations?.find((item) => item.path === spec.path) ?? null;
  const base = violationText(spec, copy, violation, result.error);
  return savedValue === attempted
    ? base
    : `${base};当前仍是 ${valueLabel(spec, copy, savedValue)}`;
}

/** 设置项控件:按契约 kind 渲染并提交。 */
export function SettingControl({
  spec,
  copy,
  value,
  onSave,
  onSaved,
}: SettingControlProps) {
  const controlId = useId();
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const shown = failure ? failure.value : value;

  /**
   * 提交一个候选值:先做与后端同区间的本地校验,再交上层保存。
   *
   * 越界值不会打后端;失败时把错误定位到本行并保留刚选的值,
   * 成功时清理失败态并触发页面级副作用。
   */
  const commit = async (next: SettingValue): Promise<void> => {
    const local = localViolation(spec, next);
    if (local) {
      setFailure({ value: next, message: violationText(spec, copy, local, null) });
      return;
    }
    const result = await onSave(spec.path, next);
    if (result.ok) {
      setFailure(null);
      onSaved?.(next);
      return;
    }
    setFailure({
      value: next,
      message: failureMessage(spec, copy, next, result, value),
    });
  };

  if (spec.kind.kind === "bool") {
    return (
      <SwitchRow
        label={copy.label}
        hint={copy.hint}
        error={failure?.message ?? null}
        checked={shown === true}
        onChange={(next) => void commit(next)}
      />
    );
  }

  if (spec.kind.kind === "text" && !copy.options) {
    return (
      <FreeTextRow
        spec={spec}
        copy={copy}
        savedValue={String(value ?? "")}
        controlId={controlId}
        error={failure?.message ?? null}
        commit={commit}
      />
    );
  }

  const choices = settingChoices(spec, copy, shown);
  return (
    <Row
      label={copy.label}
      hint={copy.hint}
      controlId={controlId}
      description={copy.optionHints?.[String(shown)]}
      error={failure?.message ?? null}
    >
      <NativeSelect
        id={controlId}
        value={String(shown ?? "")}
        onChange={(event) => {
          const choice = choices.find(
            (candidate) => String(candidate.value) === event.target.value,
          );
          if (choice !== undefined) void commit(choice.value);
        }}
      >
        {choices.map((choice) => (
          <option key={String(choice.value)} value={String(choice.value)}>
            {choice.label}
          </option>
        ))}
      </NativeSelect>
      {failure && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void commit(failure.value)}
        >
          {`重试保存 ${valueLabel(spec, copy, failure.value)}`}
        </Button>
      )}
    </Row>
  );
}

/** 自由文本行属性(契约 `text` 且文案表未登记候选时使用)。 */
interface FreeTextRowProps {
  /** 契约项(提供长度上限)。 */
  spec: SettingSpec;
  /** 表现层文案。 */
  copy: SettingCopy;
  /** 后端当前已保存值。 */
  savedValue: string;
  /** 控件 id(标签关联用)。 */
  controlId: string;
  /** 行内错误(来自上层保存结果)。 */
  error: string | null;
  /** 提交回调。 */
  commit: (value: SettingValue) => Promise<void>;
}

/**
 * 自由文本行:草稿态提交(失焦 / Enter),不逐字符保存;
 * 保存失败时保留用户输入并展示错误原文,不清空、不吞错。
 */
function FreeTextRow({
  spec,
  copy,
  savedValue,
  controlId,
  error,
  commit,
}: FreeTextRowProps) {
  const [draft, setDraft] = useState(savedValue);

  // 无错误时跟随后端值(保存成功或其它入口写回);有错误时保留用户输入。
  useEffect(() => {
    if (!error) setDraft(savedValue);
  }, [savedValue, error]);

  /** 提交草稿;与已保存值相同则不打后端。 */
  const submit = async (): Promise<void> => {
    if (draft === savedValue) return;
    await commit(draft);
  };

  return (
    <Row label={copy.label} hint={copy.hint} controlId={controlId} error={error}>
      <Input
        id={controlId}
        value={draft}
        maxLength={spec.kind.kind === "text" ? spec.kind.maxLen : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void submit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
      />
    </Row>
  );
}
