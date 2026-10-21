/**
 * 文案表与契约的覆盖测试(AGENTS.md §4.1.1「无假开关、无死文案、界面正文不写枚举原值」)。
 *
 * 渲染规则是「schema 有 + 文案表有 → 渲染」,所以:
 * - 文案表里不许出现契约没有的路径(防死文案 / 字段名漂移);
 * - 本版本承诺渲染的每一项必须有文案(防后端有能力但没入口);
 * - 每个渲染枚举项的后端候选值都必须有中文映射(防新增枚举值无翻译);
 * - 未登记的契约项(界面语言、迁移内部字段)必须继续不渲染。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SettingPath, SettingSpec } from "@/types";
import { SETTING_COPY } from "./settings-copy";
import { UNGROUPED_TITLE, buildSettingGroups } from "./setting-value";

/** 本版本承诺在设置页渲染的设置项(新增渲染项时同步本清单)。 */
const RENDERED_PATHS: SettingPath[] = [
  "appearance.theme",
  "terminal.colorScheme",
  "terminal.fontFamily",
  "terminal.fontSize",
  "terminal.lineHeight",
  "terminal.cursorStyle",
  "terminal.scrollback",
  "terminal.copyOnSelect",
  "terminal.rightClickPaste",
  "terminal.confirmCloseTab",
  "connection.keepaliveIntervalSecs",
  "connection.defaultAuthMethod",
  "transfer.maxConcurrentTasks",
  "transfer.chunkSizeKib",
  "transfer.defaultConflictPolicy",
  "transfer.notifyOnComplete",
  "monitor.defaultIntervalSecs",
  "update.autoCheck",
  "agent.approvalMode",
  "agent.maxTurns",
  "agent.contextMessages",
  "agent.batchLimit",
  "agent.parallelHosts",
  "agent.execTimeoutSecs",
  "agent.tokenBudget",
  "agent.injectMemories",
  "agent.showReasoning",
];

/** 中文字形检测:枚举映射必须是中文,不允许原值直接当标签。 */
const CJK = /[一-鿿]/;

/**
 * 读取 Rust 导出的契约 fixture。
 *
 * @returns schema 列表(与前端 `SettingSpec[]` 同形)
 */
function readSchema(): SettingSpec[] {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const fixture = JSON.parse(
    readFileSync(join(root, "src-tauri", "contract", "settings-contract.json"), "utf8"),
  ) as { schema: SettingSpec[] };
  return fixture.schema;
}

describe("设置文案表覆盖", () => {
  it("文案表每个路径都在契约 schema 中(无死文案、无字段名漂移)", () => {
    const paths = new Set(readSchema().map((spec) => spec.path));
    for (const path of Object.keys(SETTING_COPY) as SettingPath[]) {
      expect(paths.has(path), `契约不存在的路径 ${path}`).toBe(true);
    }
  });

  it("承诺渲染的项都有文案且不越界", () => {
    const schema = new Map(readSchema().map((spec) => [spec.path, spec]));
    for (const path of RENDERED_PATHS) {
      const spec = schema.get(path);
      expect(spec, `契约缺少 ${path}`).toBeDefined();
      expect(spec?.kind.kind, `${path} 不应是 hidden`).not.toBe("hidden");
      const copy = SETTING_COPY[path];
      expect(copy?.label, `${path} 缺少中文标签`).toBeTruthy();
      expect(copy?.label).toMatch(CJK);
    }
  });

  it("渲染项清单与「契约有 + 文案表有」完全一致(不静默漏渲染)", () => {
    const rendered = buildSettingGroups(readSchema(), SETTING_COPY).flatMap(
      (group) => group.items.map((item) => item.spec.path),
    );
    expect([...rendered].sort()).toEqual([...RENDERED_PATHS].sort());
  });

  it("每个渲染枚举项的候选值都有中文映射", () => {
    for (const spec of readSchema()) {
      if (spec.kind.kind !== "enum") continue;
      const options = spec.kind.options;
      const copy = SETTING_COPY[spec.path];
      if (!copy) continue;
      for (const option of options) {
        const label = copy.options?.[option];
        expect(label, `${spec.path} 的取值 ${option} 缺少中文映射`).toBeTruthy();
        expect(label, `${spec.path} 的取值 ${option} 仍是英文原值`).toMatch(CJK);
      }
      const dead = Object.keys(copy.options ?? {}).filter(
        (option) => !options.includes(option),
      );
      expect(dead, `${spec.path} 存在契约外的候选翻译`).toEqual([]);
    }
  });

  it("每个分组标题都来自文案表(不出现英文分组名兜底)", () => {
    const groups = buildSettingGroups(readSchema(), SETTING_COPY);
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.title, `${group.key} 分组缺少中文标题`).not.toBe(
        UNGROUPED_TITLE,
      );
      expect(group.title).toMatch(CJK);
    }
  });

  it("未登记的契约项继续不渲染(语言与迁移内部字段)", () => {
    const groups = buildSettingGroups(readSchema(), SETTING_COPY);
    const rendered = groups.flatMap((group) =>
      group.items.map((item) => item.spec.path),
    );
    expect(rendered).not.toContain("appearance.language");
    expect(rendered).not.toContain("migration.pendingMigrationId");
    expect(rendered).not.toContain("migration.dismissedAutoMigrations");
  });

  it("数值项档位非空且落在契约区间内(否则界面渲染出注定被拒的选项)", () => {
    for (const spec of readSchema()) {
      if (spec.kind.kind !== "int" && spec.kind.kind !== "float") continue;
      if (!SETTING_COPY[spec.path]) continue;
      expect(spec.kind.presets.length, `${spec.path} 缺少档位`).toBeGreaterThan(0);
      for (const preset of spec.kind.presets) {
        expect(preset).toBeGreaterThanOrEqual(spec.kind.min);
        expect(preset).toBeLessThanOrEqual(spec.kind.max);
      }
    }
  });
});
