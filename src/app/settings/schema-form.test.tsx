/**
 * schema 渲染器的用户可见行为测试(AGENTS.md §9:测行为不测实现)。
 *
 * 断言口径全部来自 Rust 导出的契约 fixture:档位与单位、提交路径由契约给出、
 * 后端违规定位到本行、失败保留用户选择、文案表缺失即不渲染、枚举缺翻译回退原值。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppSettings,
  SettingPath,
  SettingSpec,
  SettingViolation,
} from "@/types";
import type { SettingsSaveResult } from "@/stores/settings";
import { SchemaForm } from "./schema-form";
import { SETTING_COPY, type SettingCopy } from "./settings-copy";
import { UNGROUPED_TITLE, buildSettingGroups } from "./setting-value";

/** 契约 fixture(schema + defaults)。 */
interface ContractFixture {
  schema: SettingSpec[];
  defaults: Record<string, unknown>;
}

/**
 * 读取契约 fixture,作为渲染器测试的唯一数据源。
 *
 * @returns schema 与默认设置树
 */
function readContract(): ContractFixture {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  return JSON.parse(
    readFileSync(
      join(root, "src-tauri", "contract", "settings-contract.json"),
      "utf8",
    ),
  ) as ContractFixture;
}

const CONTRACT = readContract();
const SCHEMA = CONTRACT.schema;
const SETTINGS = CONTRACT.defaults as unknown as AppSettings;

/** 成功保存结果。 */
const OK: SettingsSaveResult = { ok: true, error: null, violations: null };

/**
 * 构造失败结果。
 *
 * @param violations 后端下发的越界详情
 * @param error 后端错误原文
 */
function fail(
  violations: SettingViolation[] | null,
  error: string | null,
): SettingsSaveResult {
  return { ok: false, error, violations };
}

/**
 * 渲染 schema 表单。
 *
 * @param overrides 局部覆盖属性(文案表裁剪、保存桩、副作用等)
 */
function renderForm(
  overrides: Partial<ComponentProps<typeof SchemaForm>> = {},
): void {
  render(
    <SchemaForm
      schema={SCHEMA}
      settings={SETTINGS}
      onSave={vi.fn(async () => OK)}
      {...overrides}
    />,
  );
}

/**
 * 按单位定位契约项(测试不写死后端字段名)。
 *
 * @param unit 契约单位
 */
function specByUnit(unit: string): SettingSpec {
  const spec = SCHEMA.find((candidate) => candidate.unit === unit);
  expect(spec, `契约里没有单位为 ${unit} 的项`).toBeDefined();
  return spec!;
}

/**
 * 取契约项的界面标签:标签仍来自文案表,避免测试与实现各写一份。
 *
 * @param path 契约路径
 */
function labelOf(path: SettingPath): string {
  const copy = SETTING_COPY[path];
  expect(copy?.label, `${path} 缺少文案`).toBeTruthy();
  return copy!.label;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // 项目未开 vitest globals,RTL 自动清理不生效,手动卸载避免用例间串染。
  cleanup();
});

describe("SchemaForm", () => {
  it("按契约档位渲染数值下拉并带上单位与默认标记", () => {
    renderForm();
    const chunk = specByUnit("KiB");
    const select = screen.getByLabelText(labelOf(chunk.path));
    expect(screen.getByRole("option", { name: "16 KiB" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "1,024 KiB" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "32 KiB(默认)" }),
    ).toBeInTheDocument();
    expect(select).toHaveValue(String(chunk.default));
  });

  it("数值 0 由文案表翻译成「关闭」,不显示裸 0", () => {
    renderForm();
    // 契约里唯一允许 0 的数值项(连接保活检测),0 由文案表映射为「关闭」。
    const keepalive = SCHEMA.find(
      (spec) =>
        spec.kind.kind === "int" &&
        spec.kind.min === 0 &&
        spec.kind.presets.includes(0),
    );
    expect(keepalive).toBeDefined();
    expect(screen.getByLabelText(labelOf(keepalive!.path))).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "关闭" })).toBeInTheDocument();
  });

  it("选中档位后按契约路径提交数值(路径来自 schema,不是硬编码)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => OK);
    renderForm({ onSave });
    const chunk = specByUnit("KiB");
    await user.selectOptions(screen.getByLabelText(labelOf(chunk.path)), "64");
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(chunk.path, 64);
    });
  });

  it("枚举项显示中文标签,未登记翻译的取值回退显示原值", () => {
    renderForm();
    const cursor = SCHEMA.find((spec) => spec.path === "terminal.cursorStyle")!;
    const options = cursor.kind.kind === "enum" ? cursor.kind.options : [];
    expect(options).toContain("block");
    expect(screen.getByRole("option", { name: "方块" })).toBeInTheDocument();

    cleanup();
    renderForm({
      copy: { ...SETTING_COPY, "terminal.cursorStyle": { label: "光标样式" } },
    });
    // 缺翻译时回退显示契约原值(不静默吞掉),文案覆盖测试会抓到这种回退。
    expect(screen.getByRole("option", { name: "bar" })).toBeInTheDocument();
  });

  it("开关项按契约路径提交布尔值", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => OK);
    renderForm({ onSave });
    await user.click(
      screen.getByRole("switch", { name: labelOf("update.autoCheck") }),
    );
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("update.autoCheck", false);
    });
  });

  it("保存成功后才触发页面级副作用(主题切换由页面注入)", async () => {
    const user = userEvent.setup();
    const sideEffect = vi.fn();
    const onSave = vi.fn(async (): Promise<SettingsSaveResult> => OK);
    renderForm({ onSave, sideEffects: { "appearance.theme": sideEffect } });
    await user.selectOptions(
      screen.getByLabelText(labelOf("appearance.theme")),
      "light",
    );
    await waitFor(() => expect(sideEffect).toHaveBeenCalledWith("light"));

    cleanup();
    const failing = vi.fn(async (): Promise<SettingsSaveResult> =>
      fail(null, "后端拒绝"),
    );
    const never = vi.fn();
    renderForm({ onSave: failing, sideEffects: { "appearance.theme": never } });
    await user.selectOptions(
      screen.getByLabelText(labelOf("appearance.theme")),
      "dark",
    );
    await waitFor(() => expect(failing).toHaveBeenCalled());
    expect(never).not.toHaveBeenCalled();
  });

  it("文案表未登记的契约项不渲染", () => {
    const trimmed: Partial<Record<SettingPath, SettingCopy>> = {
      ...SETTING_COPY,
    };
    delete trimmed["update.autoCheck"];
    renderForm({ copy: trimmed });
    expect(screen.queryByText("自动检查更新")).not.toBeInTheDocument();
    // 其余分组不受影响,证明跳过是逐项生效而非整页失败。
    expect(screen.getByLabelText("分块大小")).toBeInTheDocument();
  });

  it("分组标题取文案表登记项,标题挂在该组哪一项都不影响", () => {
    const groups = buildSettingGroups(SCHEMA, {
      "transfer.chunkSizeKib": { label: "分块大小", groupTitle: "传输" },
      "transfer.notifyOnComplete": { label: "传输完成时提示我" },
    });
    expect(groups.map((group) => group.title)).toEqual(["传输"]);
    expect(groups[0]!.title).not.toBe(UNGROUPED_TITLE);
  });

  it("契约完全没有可渲染项时给可读空态而不是白屏", () => {
    renderForm({ copy: {} });
    expect(screen.getByText(/后端没有返回可显示的设置项/)).toBeInTheDocument();
  });

  it("字体族保留前端候选列表,候选外的当前值补一项展示", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => OK);
    const custom = "LXGW Mono, monospace";
    renderForm({
      onSave,
      settings: {
        ...SETTINGS,
        terminal: { ...SETTINGS.terminal, fontFamily: custom },
      },
    });
    expect(
      screen.getByRole("option", { name: `${custom}(当前)` }),
    ).toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText(labelOf("terminal.fontFamily")),
      "Consolas, monospace",
    );
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        "terminal.fontFamily",
        "Consolas, monospace",
      ),
    );
  });

  it("同组项归入同一个中文分组标题", () => {
    renderForm();
    expect(screen.getByRole("heading", { name: "传输" })).toBeInTheDocument();
    expect(screen.getByText("分块大小")).toBeInTheDocument();
    expect(screen.getByText("同名文件默认处理")).toBeInTheDocument();
  });
});
