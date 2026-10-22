#!/usr/bin/env node
/**
 * 同步更新三个版本号文件:
 *   - package.json
 *   - src-tauri/Cargo.toml
 *   - src-tauri/tauri.conf.json
 *
 * 用法:
 *   bun run bump 0.3.0              # 显式指定新版本(走 npm version 前的预检)
 *   bun run bump 0.3.0-beta         # 显式指定,支持 -预发布 / +构建 元数据
 *   bun run bump patch              # 0.2.0 -> 0.2.1(位段递增会丢弃预发布段)
 *   bun run bump minor              # 0.2.0 -> 0.3.0
 *   bun run bump major              # 0.2.0 -> 1.0.0
 *   bun run bump prerelease         # 0.3.0-beta -> 0.3.0-beta.1(迭代预发布号)
 *   bun run bump prerelease rc      # 0.3.0 -> 0.3.1-rc.1(正式版起步,缺省 preid 为 beta)
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

/**
 * semver 2.0.0:MAJOR.MINOR.PATCH 核心,允许 `-预发布` 与 `+构建元数据`
 * 后缀(如 0.3.0-beta、0.3.0-beta.1+exp)。预发布段与构建元数据只做
 * 透传校验,不做语义解释。
 */
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

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

/**
 * 纯函数:按模式计算下一版本号,不做任何 I/O。
 *
 * 语义对齐 `npm version`:
 *   - patch|minor|major:对应位段递增,丢弃预发布段与构建元数据
 *     (如 0.3.0-beta 的 patch 递增结果是 0.3.0,即转正);
 *   - prerelease [preid]:迭代预发布号。当前已带预发布段时原位递增其
 *     最后一段数字(`beta` -> `beta.1`,`beta.2` -> `beta.3`);当前是
 *     正式版时递增 patch 并以 `<preid>.1` 起步(缺省 preid 为 beta);
 *   - 显式版本:必须匹配 SEMVER_RE(支持 -预发布 / +构建 元数据)。
 *
 * @param {string} current 当前版本(调用方保证三处文件一致)
 * @param {string} arg "patch"|"minor"|"major"|"prerelease [preid]"|显式版本
 * @returns {{ ok: true, next: string } | { ok: false, error: string }}
 */
export function nextVersion(current, arg) {
  if (!arg) {
    return {
      ok: false,
      error: "缺少目标版本或模式(patch|minor|major|prerelease [preid]|x.y.z[-pre])",
    };
  }
  const m = SEMVER_RE.exec(current);
  if (!m) {
    return { ok: false, error: `当前版本 "${current}" 不是合法 semver` };
  }
  const [, maj, min, pat, pre] = m;

  // 位段递增对齐 node-semver 的 inc:版本带预发布段时,"转正"(丢弃预发布
  // 段)本身就严格大于当前版本,只有当对应位段不是"新鲜"的(如 minor 递增
  // 要求 patch===0)才真正进位。例:0.3.0-beta --patch--> 0.3.0,
  // 0.3.1-beta --minor--> 0.4.0。
  if (arg === "major") {
    const nextMaj = pre && min === "0" && pat === "0" ? maj : String(Number(maj) + 1);
    return { ok: true, next: `${nextMaj}.0.0` };
  }
  if (arg === "minor") {
    const nextMin = pre && pat === "0" ? min : String(Number(min) + 1);
    return { ok: true, next: `${maj}.${nextMin}.0` };
  }
  if (arg === "patch") {
    const nextPat = pre ? pat : String(Number(pat) + 1);
    return { ok: true, next: `${maj}.${min}.${nextPat}` };
  }

  if (arg === "prerelease" || arg.startsWith("prerelease ")) {
    const preid = arg === "prerelease" ? "beta" : arg.slice("prerelease ".length).trim();
    if (!/^[0-9A-Za-z-]+$/.test(preid)) {
      return { ok: false, error: `非法 preid: "${preid}"(只允许字母数字与连字符)` };
    }
    if (!pre) {
      return {
        ok: true,
        next: `${maj}.${min}.${Number(pat) + 1}-${preid}.1`,
      };
    }
    const segments = pre.split(".");
    const last = segments[segments.length - 1];
    const nextSegments = /^\d+$/.test(last)
      ? [...segments.slice(0, -1), String(Number(last) + 1)]
      : [...segments, "1"];
    return { ok: true, next: `${maj}.${min}.${pat}-${nextSegments.join(".")}` };
  }

  if (SEMVER_RE.test(arg)) return { ok: true, next: arg };

  return {
    ok: false,
    error: `未知参数: ${arg}(期望 patch|minor|major|prerelease [preid] 或 x.y.z[-pre])`,
  };
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
  // 允许 "prerelease rc" 这类带空格的模式:合并所有 CLI 参数。
  const arg = process.argv.slice(2).join(" ");
  if (!arg) {
    console.error("用法: bun run bump <patch|minor|major|prerelease [preid]|x.y.z[-pre]>");
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

  const result = nextVersion(current, arg);
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  const next = result.next;

  if (next === current) {
    console.log(`当前已是 ${current},无需变更。`);
    return;
  }

  for (const f of FILES) applyVersion(f, next);
  console.log(`✓ ${current} -> ${next}`);
  for (const f of FILES) console.log(`  ${f.path}`);
}

/**
 * 公共 API:把版本号改成 `next`(支持 "patch"|"minor"|"major"|
 * "prerelease [preid]"|"x.y.z[-pre]")。不抛错,失败返回 `{ ok: false, error }`。
 *
 * @param {string} nextArg 目标模式或显式版本号
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

  const result = nextVersion(previous, nextArg);
  if (!result.ok) return result;
  if (result.next === previous) {
    return { ok: false, error: `当前已是 ${previous},无需变更` };
  }
  for (const f of FILES) applyVersion(f, result.next);
  return { ok: true, previous, next: result.next };
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
