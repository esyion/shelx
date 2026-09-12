#!/usr/bin/env node
/**
 * 同步更新三个版本号文件:
 *   - package.json
 *   - src-tauri/Cargo.toml
 *   - src-tauri/tauri.conf.json
 *
 * 用法:
 *   bun run bump 0.3.0          # 显式指定新版本(走 npm version 前的预检)
 *   bun run bump patch          # 0.2.0 -> 0.2.1
 *   bun run bump minor          # 0.2.0 -> 0.3.0
 *   bun run bump major          # 0.2.0 -> 1.0.0
 *
 * 退出码:0 成功,1 非法输入,2 文件缺失或写入失败。
 *
 * 设计要点(AGENTS.md §12 小步提交):
 *   - 不做任何 git 操作:用户自行 review 后 commit + tag。
 *   - 三处必须同步,否则 release workflow 行为不可预测。
 *   - 不动 lock 文件 / 不动 changelog。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const FILES = [
  { path: resolve(ROOT, "package.json"), kind: "json", key: "version" },
  { path: resolve(ROOT, "src-tauri/Cargo.toml"), kind: "toml", key: "package.version" },
  { path: resolve(ROOT, "src-tauri/tauri.conf.json"), kind: "json", key: "version" },
];

/** semver 三段式,允许预发布标签(alpha-1 / rc.1)?为简化先只允许 MAJOR.MINOR.PATCH。 */
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function readAll() {
  const current = {};
  for (const f of FILES) {
    try {
      const text = readFileSync(f.path, "utf8");
      const data = f.kind === "json" ? JSON.parse(text) : parseToml(text);
      let val;
      if (f.kind === "json") {
        val = data[f.key];
      } else {
        let cursor = data;
        for (const part of f.key.split(".")) cursor = cursor?.[part];
        val = cursor;
      }
      current[f.path] = val;
    } catch (err) {
      console.error(`读取失败: ${f.path}\n  ${err.message}`);
      process.exit(2);
    }
  }
  return current;
}

/** 极简 TOML 解析:把每个 `[section]` 与 `[a.b]` 都建成独立嵌套对象,
 *  kv 仅识别字符串值,非字符串行(数组 / 数字 / 内联表)安全忽略。
 *  不依赖 toml 包,只为本脚本读 version 字段,避免引入依赖。 */
function parseToml(text) {
  const out = {};
  let section = out;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      const key = header[1].trim();
      const parts = key.split(".");
      let cursor = out;
      for (const part of parts) {
        cursor[part] = cursor[part] && typeof cursor[part] === "object" ? cursor[part] : {};
        cursor = cursor[part];
      }
      section = cursor;
      continue;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*"([^"]*)"\s*$/);
    if (kv) section[kv[1]] = kv[2];
  }
  return out;
}

function bump(current, mode) {
  const m = SEMVER_RE.exec(current);
  if (!m) {
    console.error(`当前版本 "${current}" 不是合法 semver(major.minor.patch)`);
    process.exit(1);
  }
  let [_, maj, min, pat] = m;
  if (mode === "major") return `${Number(maj) + 1}.0.0`;
  if (mode === "minor") return `${maj}.${Number(min) + 1}.0`;
  if (mode === "patch") return `${maj}.${min}.${Number(pat) + 1}`;
  return null;
}

function applyVersion(file, newVersion) {
  const text = readFileSync(file.path, "utf8");
  let next;
  if (file.kind === "json") {
    // 原地正则替换 "version": "x.y.z",  → "version": "<new>",
    // 不走 JSON.parse/stringify,避免重排 key、丢注释、丢 BOM。
    // 仅匹配顶层键(JSON.stringify 顶层缩进 2 空格,匹配 `  "version":`)。
    const re = new RegExp(`(^[ \\t]*"${file.key}"\\s*:\\s*)"[^"]*"`, "m");
    next = text.replace(re, `$1"${newVersion}"`);
  } else {
    // Cargo.toml:替换 [package] 块下的 version 行(保留缩进)
    next = text.replace(
      /^(\[package\][\s\S]*?^version\s*=\s*)"[^"]*"/m,
      `$1"${newVersion}"`,
    );
  }
  if (next === text) {
    console.error(`未能替换: ${file.path}`);
    process.exit(2);
  }
  writeFileSync(file.path, next, "utf8");
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("用法: bun run bump <patch|minor|major|x.y.z>");
    process.exit(1);
  }
  const currentMap = readAll();
  const versions = Object.values(currentMap);
  if (new Set(versions).size !== 1) {
    console.error("三处 version 不一致,请先手动对齐:");
    for (const [p, v] of Object.entries(currentMap)) console.error(`  ${p}: ${v}`);
    process.exit(1);
  }
  const current = versions[0];

  let next;
  if (SEMVER_RE.test(arg)) {
    next = arg;
  } else if (["patch", "minor", "major"].includes(arg)) {
    next = bump(current, arg);
  } else {
    console.error(`未知参数: ${arg}(期望 patch|minor|major 或 x.y.z)`);
    process.exit(1);
  }

  if (next === current) {
    console.log(`当前已是 ${current},无需变更。`);
    return;
  }
  if (!SEMVER_RE.test(next)) {
    console.error(`计算结果 "${next}" 不是合法 semver`);
    process.exit(1);
  }

  for (const f of FILES) applyVersion(f, next);
  console.log(`✓ ${current} -> ${next}`);
  for (const f of FILES) console.log(`  ${f.path}`);
}

/**
 * 公共 API:把版本号改成 `next`(支持 "patch"|"minor"|"major"|"x.y.z")。
 * 不抛错,失败返回 `{ ok: false, error }`。
 *
 * @param {"patch"|"minor"|"major"|`${number}.${number}.${number}`} nextArg
 * @returns {{ ok: true; previous: string; next: string } | { ok: false; error: string }}
 */
export function bumpVersion(nextArg) {
  const currentMap = readAll();
  const versions = Object.values(currentMap);
  if (new Set(versions).size !== 1) {
    const lines = Object.entries(currentMap).map(([p, v]) => `  ${p}: ${v}`).join("\n");
    return { ok: false, error: `三处 version 不一致:\n${lines}` };
  }
  const previous = versions[0];

  let next;
  if (SEMVER_RE.test(nextArg)) {
    next = nextArg;
  } else if (["patch", "minor", "major"].includes(nextArg)) {
    next = bump(previous, nextArg);
  } else {
    return { ok: false, error: `未知参数: ${nextArg}(期望 patch|minor|major 或 x.y.z)` };
  }
  if (!next || !SEMVER_RE.test(next)) {
    return { ok: false, error: `计算结果 "${next}" 不是合法 semver` };
  }
  if (next === previous) {
    return { ok: false, error: `当前已是 ${previous},无需变更` };
  }
  for (const f of FILES) applyVersion(f, next);
  return { ok: true, previous, next };
}

/**
 * 公共 API:读取当前三处版本号,返回 { ok, value | error }。
 * 仅用于校验,不应触发写入。
 */
export function readCurrentVersion() {
  const currentMap = readAll();
  const versions = Object.values(currentMap);
  if (new Set(versions).size !== 1) {
    const lines = Object.entries(currentMap).map(([p, v]) => `  ${p}: ${v}`).join("\n");
    return { ok: false, error: `三处 version 不一致:\n${lines}` };
  }
  return { ok: true, value: versions[0] };
}

// 仅在直接执行(而非被 import)时跑 CLI 主流程。
if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, "/") ?? "")) {
  main();
}
