/**
 * 契约生成物守卫测试(AGENTS.md §5):前端类型只能来自 Rust 导出。
 *
 * 覆盖本次事故与后续防线:
 * - 分块大小的错误写法 `chunkSizeKiB` 不得再出现在任何生成物里(历史漂移回归锁);
 * - schema 文档里的每个模块与每个导出类型都必须落到 `src/types/gen/` 的某个文件;
 * - 生成物必须带"请勿手改"头,防止有人绕过 codegen 手写类型;
 * - 错误码枚举来自生成物(不再手写字符串)。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const genDir = join(repoRoot, "src", "types", "gen");

/** 读取契约文档。 */
function schemaDoc() {
  const raw = readFileSync(
    join(repoRoot, "src-tauri", "contract", "ipc-schema.json"),
    "utf8",
  );
  return JSON.parse(raw) as {
    version: number;
    modules: Record<string, { properties: Record<string, unknown> }>;
  };
}

/** 读取设置项运行时契约(路径清单)。 */
function settingPaths(): string[] {
  const raw = readFileSync(
    join(repoRoot, "src-tauri", "contract", "settings-contract.json"),
    "utf8",
  );
  return JSON.parse(raw).schema.map((spec: { path: string }) => spec.path);
}

/** 去掉注释,只检查真正参与类型的文本(历史说明里允许出现旧拼写)。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("IPC 契约生成物", () => {
  it("契约文档版本已生成且模块非空", () => {
    const doc = schemaDoc();
    expect(doc.version).toBeGreaterThan(0);
    expect(Object.keys(doc.modules).length).toBeGreaterThan(0);
  });

  it("每个模块与导出类型都有对应生成物", () => {
    const doc = schemaDoc();
    for (const [module, schema] of Object.entries(doc.modules)) {
      const file = join(genDir, `${module}.ts`);
      expect(existsSync(file), `缺少生成物 ${module}.ts`).toBe(true);
      const text = readFileSync(file, "utf8");
      for (const typeName of Object.keys(schema.properties)) {
        expect(text, `${module}.ts 未导出 ${typeName}`).toMatch(
          new RegExp(`export (interface|type) ${typeName}\\b`),
        );
      }
    }
  });

  it("生成物都带禁止手改的头", () => {
    const doc = schemaDoc();
    for (const module of Object.keys(doc.modules)) {
      const text = readFileSync(join(genDir, `${module}.ts`), "utf8");
      expect(text).toContain("请勿手改");
    }
  });

  it("分块大小只有 chunkSizeKib,历史错误写法 chunkSizeKiB 全库消失", () => {
    const paths = settingPaths();
    expect(paths).toContain("transfer.chunkSizeKib");
    expect(paths).not.toContain("transfer.chunkSizeKiB");
    for (const module of Object.keys(schemaDoc().modules)) {
      expect(
        stripComments(readFileSync(join(genDir, `${module}.ts`), "utf8")),
      ).not.toContain("chunkSizeKiB");
    }
    const settingsBarrel = readFileSync(
      join(repoRoot, "src", "types", "settings.ts"),
      "utf8",
    );
    expect(stripComments(settingsBarrel)).not.toContain("chunkSizeKiB");
  });

  it("设置项路径联合与后端 schema 数据逐字一致", () => {
    const generated = readFileSync(join(genDir, "settingPaths.ts"), "utf8");
    for (const path of settingPaths()) {
      expect(generated, `SettingPath 缺少 ${path}`).toContain(`"${path}"`);
    }
    expect(generated).toContain("export type SettingPath");
  });

  it("错误码枚举由生成物提供,不再手写字符串联合", () => {
    const text = readFileSync(join(genDir, "ipc.ts"), "utf8");
    expect(text).toContain("export type IpcErrorCode");
    for (const code of ["AUTH_FAILED", "HOSTKEY_CHANGED", "INVALID_ARGUMENT"]) {
      expect(text).toContain(`"${code}"`);
    }
    const barrel = readFileSync(join(repoRoot, "src", "types", "ipc.ts"), "utf8");
    expect(barrel).toContain('export type { IpcError, IpcErrorCode } from "./gen/ipc"');
    // 信封本体是规范固定的泛型,不是后端字段镜像。
    expect(barrel).toContain("export type IpcResult<T>");
  });
});
