/**
 * 设置项控件的失败处理测试(AGENTS.md §4.1.1「失败不丢输入、不吞后端错误」)。
 *
 * 用例数据仍来自 Rust 导出的契约 fixture:后端下发越界详情时错误定位到本行、
 * 文案含契约区间与单位、用户刚选的值保留并可重试;只有错误原文时原样展示;
 * 自由文本走草稿提交,失败后输入仍在。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, SettingPath, SettingSpec, SettingViolation } from "@/types";
import type { SettingsSaveResult } from "@/stores/settings";
import { SchemaForm } from "./schema-form";
import { SETTING_COPY, type SettingCopy } from "./settings-copy";

/** 契约 fixture(schema + defaults)。 */
interface ContractFixture {
  schema: SettingSpec[];
  defaults: Record<string, unknown>;
}

/**
 * 读取契约 fixture。
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

const SCHEMA = readContract().schema;
const SETTINGS = readContract().defaults as unknown as AppSettings;

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
 * 取契约项的界面标签。
 *
 * @param path 契约路径
 */
function labelOf(path: SettingPath): string {
  const copy = SETTING_COPY[path];
  expect(copy?.label, `${path} 缺少文案`).toBeTruthy();
  return copy!.label;
}

/**
 * 构造失败保存结果。
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
 * 渲染只含目标契约项的表单,便于隔离单个控件行为。
 *
 * @param spec 契约项
 * @param copy 该项文案
 * @param onSave 保存桩
 * @param settings 覆盖用的设置值
 */
function renderOne(
  spec: SettingSpec,
  copy: SettingCopy,
  onSave: (path: SettingPath, value: unknown) => Promise<SettingsSaveResult>,
  settings: AppSettings = SETTINGS,
): void {
  render(
    <SchemaForm
      schema={[spec]}
      settings={settings}
      copy={{ [spec.path]: copy } as Partial<Record<SettingPath, SettingCopy>>}
      onSave={onSave}
    />,
  );
}

afterEach(() => {
  // 项目未开 vitest globals,RTL 自动清理不生效,手动卸载避免用例间串染。
  cleanup();
});

describe("设置项控件失败处理", () => {
  it("后端下发越界详情时错误显示在本行、文案含区间与单位且保留用户选择", async () => {
    const user = userEvent.setup();
    const chunk = specByUnit("KiB");
    const onSave = vi.fn(async (): Promise<SettingsSaveResult> =>
      fail(
        [{ path: chunk.path, min: 4, max: 1024, unit: "KiB", received: 4096 }],
        "transfer.chunkSizeKib 必须在 4–1024 KiB 之间",
      ),
    );
    renderOne(chunk, SETTING_COPY[chunk.path]!, onSave);
    const select = screen.getByLabelText(labelOf(chunk.path));
    await user.selectOptions(select, "1024");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("4–1,024 KiB");
    expect(alert.closest("[data-setting-row]")).toBe(
      select.closest("[data-setting-row]"),
    );
    // 用户刚选的值不消失,并提供重试入口。
    expect(select).toHaveValue("1024");
    const retry = screen.getByRole("button", { name: /重试保存/ });
    await user.click(retry);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  });

  it("后端只给错误原文时原样展示,不用固定文案吞错", async () => {
    const user = userEvent.setup();
    const theme = SCHEMA.find((spec) => spec.path === "appearance.theme")!;
    const onSave = vi.fn(async (): Promise<SettingsSaveResult> =>
      fail(null, "设置文件被其它进程占用"),
    );
    renderOne(theme, SETTING_COPY["appearance.theme"]!, onSave);
    await user.selectOptions(screen.getByLabelText(labelOf(theme.path)), "dark");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("设置文件被其它进程占用");
  });

  it("文本项无候选列表时退化为自由输入:失焦才提交,失败不丢输入", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (): Promise<SettingsSaveResult> =>
      fail(null, "字体栈保存被拒绝"),
    );
    const spec: SettingSpec = {
      path: "terminal.fontFamily",
      group: "terminal",
      unit: "字符",
      kind: { kind: "text", maxLen: 40 },
      default: "",
    };
    renderOne(spec, { label: "字体栈" }, onSave);
    const input = screen.getByLabelText("字体栈");
    await user.clear(input);
    await user.type(input, "自定义字体");
    expect(onSave).not.toHaveBeenCalled();

    await user.tab();
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("terminal.fontFamily", "自定义字体"),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "字体栈保存被拒绝",
    );
    expect(input).toHaveValue("自定义字体");
  });

  it("档位越界(契约漂移)时提交前就被本地拦下,不打后端", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (): Promise<SettingsSaveResult> => ({
      ok: true,
      error: null,
      violations: null,
    }));
    // 故意构造 max < preset 的契约:界面不该发出注定被拒的值。
    const spec: SettingSpec = {
      path: "transfer.maxConcurrentTasks",
      group: "transfer",
      unit: "个",
      kind: { kind: "int", min: 1, max: 4, presets: [1, 2, 8] },
      default: 2,
    };
    renderOne(spec, { label: "并发任务数" }, onSave);
    const select = screen.getByLabelText("并发任务数");
    await user.selectOptions(select, "8");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("1–4 个");
    expect(onSave).not.toHaveBeenCalled();
    // 越界值仍然可见,用户能改回合法档位。
    expect(select).toHaveValue("8");
  });
});
