#!/usr/bin/env node
/**
 * 一站式发布脚本:
 *   1. 检查工作树干净(三处 version 一致 + 无未提交改动)
 *   2. 按 patch|minor|major|x.y.z bump 三处版本号
 *   3. 跑 fmt / clippy / test / 前端 build 作为质量门禁
 *   4. 自动 commit + 打 annotated tag(不 push,留给用户确认)
 *   5. 打印 push 指令
 *
 * 设计取舍(AGENTS.md §12 小步提交 + §11 不擅自 push):
 *   - 不动 git push:push 触发 CI 配额 + Secret 配置风险由用户承担
 *   - 不动 CHANGELOG:留给用户在 commit 前后手动补,这是发布说明的事实来源
 *   - bump 类型默认 patch,可显式覆盖
 *
 * 用法:
 *   bun run release           # 默认 patch(0.2.1 -> 0.2.2)
 *   bun run release minor
 *   bun run release major
 *   bun run release 0.5.0
 *
 * 退出码:0 成功,1 前置检查失败,2 bump 失败,3 质量门禁失败,4 commit/tag 失败。
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bumpVersion, readCurrentVersion } from "./bump-version.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const COLOR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};
const c = (color, text) => `${COLOR[color]}${text}${COLOR.reset}`;

const log = {
  step: (n, title) => console.log(`\n${c("cyan", `▶ 步骤 ${n}: ${title}`)}`),
  ok: (msg) => console.log(`${c("green", "✓")} ${msg}`),
  warn: (msg) => console.log(`${c("yellow", "⚠")} ${msg}`),
  err: (msg) => console.error(`${c("red", "✗")} ${msg}`),
};

/** 在 shell 同步执行并打印;非零退出码抛错。 */
function sh(cmd, args, opts = {}) {
  const display = [cmd, ...args].join(" ");
  console.log(`${c("dim", `$ ${display}`)}`);
  try {
    return execFileSync(cmd, args, {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      ...opts,
    });
  } catch (err) {
    throw new Error(`${display} 失败: ${err.message}`);
  }
}

/** spawn 子进程返回 ExitStatus,不抛错;适合做条件分支。 */
function shStatus(cmd, args) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
}

/**
 * 步骤 1:前置检查。
 *   - 工作树干净(允许未跟踪的 docs/ 临时文件但要求 git status 简短)
 *   - 当前三处 version 一致
 *   - 工具链存在(bun / cargo)
 */
function preflight() {
  log.step(1, "前置检查");
  if (!existsSync(resolve(ROOT, "package.json"))) {
    log.err("在仓库根目录外运行?找不到 package.json");
    process.exit(1);
  }

  const status = shStatus("git", ["status", "--porcelain"]);
  if (status.stdout.trim()) {
    log.err("工作树有未提交改动,请先 commit 或 stash:");
    console.error(status.stdout);
    process.exit(1);
  }
  log.ok("工作树干净");

  const cur = readCurrentVersion();
  if (!cur.ok) {
    log.err(cur.error);
    process.exit(1);
  }
  log.ok(`当前版本:${c("bold", "v" + cur.value)}`);
  return cur.value;
}

/**
 * 步骤 2:bump 版本号。
 * @param {string | undefined} arg 用户传入的 bump 类型或显式版本
 */
function bump(arg) {
  log.step(2, "Bump 版本号");
  const mode = arg ?? "patch";
  const result = bumpVersion(mode);
  if (!result.ok) {
    log.err(result.error);
    process.exit(2);
  }
  log.ok(`${c("bold", result.previous)} → ${c("bold", "v" + result.next)}`);
  return result.next;
}

/** 步骤 3:质量门禁——fmt / clippy / test / 前端 build。 */
function qualityGates() {
  log.step(3, "质量门禁(fmt / clippy / test / build)");

  log.ok("cargo fmt --check");
  try {
    sh("cargo", ["fmt", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check"]);
  } catch {
    log.err("cargo fmt 失败。运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 修复后再试。");
    process.exit(3);
  }

  log.ok("cargo clippy");
  try {
    sh("cargo", [
      "clippy",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--all-targets",
      "--",
      "-D",
      "warnings",
    ]);
  } catch {
    log.err("cargo clippy 失败。");
    process.exit(3);
  }

  log.ok("cargo test");
  try {
    sh("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--lib"]);
  } catch {
    log.err("cargo test 失败。");
    process.exit(3);
  }

  log.ok("bun run build(前端静态导出)");
  try {
    sh("bun", ["run", "build"]);
  } catch {
    log.err("前端 build 失败。");
    process.exit(3);
  }
}

/**
 * 步骤 4:commit + 打 tag。
 * 把三处版本号的修改作为独立 commit(便于日后追溯 release 点),
 * tag 用 annotated 形式(带 tagger + 注释,GitHub Releases 可识别)。
 */
function commitAndTag(version) {
  log.step(4, "Commit + 打 Tag");
  try {
    sh("git", [
      "add",
      "package.json",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
      "src-tauri/tauri.conf.json",
    ]);
    sh("git", [
      "-c",
      "user.name=chario",
      "-c",
      "user.email=qingbomy@gmail.com",
      "commit",
      "-m",
      `chore(release): bump to ${version}`,
    ]);
    log.ok("已 commit 版本号变更");
  } catch {
    log.err("git commit 失败。");
    process.exit(4);
  }

  const tagName = `v${version}`;
  try {
    sh("git", ["tag", "-a", tagName, "-m", tagName]);
    log.ok(`已打 tag ${c("bold", tagName)}`);
  } catch {
    log.err("git tag 失败。");
    process.exit(4);
  }
}

/** 步骤 5:打印 push 指令;不自动 push。 */
function printPushInstructions(version) {
  log.step(5, "准备推送");
  const tagName = `v${version}`;
  console.log(`
tag ${c("bold", tagName)} 已就绪,以下命令请人工执行以触发 CI:

    ${c("bold", "git push origin main")}
    ${c("bold", `git push origin ${tagName}`)}

push 后访问 ${c("cyan", "https://github.com/esyion/shelx/actions")} 观察 Release workflow。

${c("dim", "提示:本脚本故意不自动 push——push 会消耗 GitHub Actions 配额,且若")}
${c("dim", "TAURI_SIGNING_PRIVATE_KEY secret 缺失会导致 release workflow 失败。")}
${c("dim", "如果你确认 Secret 已配置,可以一次性 push:")
}
    ${c("bold", `git push origin main ${tagName}`)}
`);
}

/** 主流程串联。 */
function main() {
  const arg = process.argv[2];
  if (arg === "--help" || arg === "-h") {
    console.log(`用法: bun run release [patch|minor|major|x.y.z]

默认 patch。其它模式显式传参。`);
    process.exit(0);
  }

  console.log(c("bold", "shelx 发布流程"));
  console.log(c("dim", "(push 留给人工执行,本脚本只到 commit + tag)"));

  const previous = preflight();
  const next = bump(arg);
  if (next === previous) {
    log.warn("bump 没有变化,提前结束(可能你想用显式版本号?)");
    process.exit(0);
  }

  qualityGates();
  commitAndTag(next);
  printPushInstructions(next);
}

main();
