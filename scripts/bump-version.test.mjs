import { describe, expect, it } from "vitest";

import { nextVersion } from "./bump-version.mjs";

/**
 * nextVersion 纯函数回归测试。覆盖 0.3.0-beta 发布时暴露的缺口:
 * 旧 SEMVER_RE 只认严格 X.Y.Z,预发布号会被整个拒绝。
 */
describe("nextVersion", () => {
  it("接受显式预发布版本号(含构建元数据)", () => {
    expect(nextVersion("0.2.26", "0.3.0-beta")).toEqual({
      ok: true,
      next: "0.3.0-beta",
    });
    expect(nextVersion("0.3.0-beta", "0.3.0-beta.1+exp")).toEqual({
      ok: true,
      next: "0.3.0-beta.1+exp",
    });
  });

  it("位段递增丢弃预发布与构建元数据(node-semver inc 语义)", () => {
    // 转正路径:对应位段已是"新鲜"的,丢弃预发布段即严格变大,不再进位。
    expect(nextVersion("0.3.0-beta", "patch")).toEqual({ ok: true, next: "0.3.0" });
    expect(nextVersion("0.3.0-beta", "minor")).toEqual({ ok: true, next: "0.3.0" });
    expect(nextVersion("0.3.0-beta+exp", "patch")).toEqual({ ok: true, next: "0.3.0" });
    // patch 只要带预发布段就只转正不进位;minor/major 在非新鲜位段正常进位。
    expect(nextVersion("0.3.1-beta", "patch")).toEqual({ ok: true, next: "0.3.1" });
    expect(nextVersion("0.3.2-beta", "patch")).toEqual({ ok: true, next: "0.3.2" });
    expect(nextVersion("0.3.1-beta", "minor")).toEqual({ ok: true, next: "0.4.0" });
    expect(nextVersion("0.3.0-beta+exp", "major")).toEqual({ ok: true, next: "1.0.0" });
  });

  it("prerelease 迭代已有预发布段的最后一段数字", () => {
    expect(nextVersion("0.3.0-beta", "prerelease")).toEqual({
      ok: true,
      next: "0.3.0-beta.1",
    });
    expect(nextVersion("0.3.0-beta.1", "prerelease")).toEqual({
      ok: true,
      next: "0.3.0-beta.2",
    });
  });

  it("prerelease 从正式版起步:递增 patch 并用 preid 命名", () => {
    expect(nextVersion("0.3.0", "prerelease")).toEqual({
      ok: true,
      next: "0.3.1-beta.1",
    });
    expect(nextVersion("0.3.0", "prerelease rc")).toEqual({
      ok: true,
      next: "0.3.1-rc.1",
    });
  });

  it("拒绝非法输入", () => {
    expect(nextVersion("0.3.0", "").ok).toBe(false);
    expect(nextVersion("0.3.0", "0.3").ok).toBe(false);
    expect(nextVersion("0.3.0", "next").ok).toBe(false);
    expect(nextVersion("0.3.0", "prerelease bad id").ok).toBe(false);
    expect(nextVersion("不是版本号", "patch").ok).toBe(false);
  });
});
