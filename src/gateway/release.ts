/**
 * GitHub Releases API 客户端:用于应用内版本检测。
 *
 * 走前端普通 fetch,不经 Tauri command(IPC 边界外;
 * 不占用 Rust 端资源,不污染 ipc.ts 的 IpcResult 契约)。
 *
 * CSP 限制:本项目 devCsp 已显式放行 http(s) 默认请求。
 * 仅调用 api.github.com,GET /repos/{owner}/{repo}/releases/latest。
 */
import type { GithubRelease } from "@/types";

/** 默认仓库地址,可通过 `setReleaseRepository` 切换(如 fork)。 */
const DEFAULT_REPOSITORY = "esyion/shelx";

/** 单次响应缓存 TTL(毫秒),避免每次渲染都打 GitHub。 */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** 当前仓库;模块级变量,单例。 */
let currentRepo: string = DEFAULT_REPOSITORY;
/** 简单内存缓存:同 repo 内 10 分钟内复用上一次结果。 */
let cache: { repo: string; fetchedAt: number; data: GithubRelease } | null = null;

/**
 * 切换版本检测的目标仓库(测试用 / fork)。
 * 不抛错,空字符串会被忽略,保留旧值。
 */
export function setReleaseRepository(repo: string): void {
  if (repo && repo.includes("/")) currentRepo = repo;
  cache = null;
}

/** 当前生效的仓库,形如 `owner/repo`。 */
export function getReleaseRepository(): string {
  return currentRepo;
}

/**
 * 拉取 GitHub 上指定仓库的最新 release。
 *
 * @param opts.force 跳过缓存(用户手动点击"检查更新"时使用)
 * @throws 当网络失败 / 限流 / 仓库不存在时抛 Error,消息面向日志,不直接展示给最终用户
 */
export async function fetchLatestRelease(opts: { force?: boolean } = {}): Promise<GithubRelease> {
  const now = Date.now();
  if (
    !opts.force &&
    cache &&
    cache.repo === currentRepo &&
    now - cache.fetchedAt < DEFAULT_TTL_MS
  ) {
    return cache.data;
  }

  const url = `https://api.github.com/repos/${currentRepo}/releases/latest`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 404) {
    throw new Error(`仓库 ${currentRepo} 暂无 release`);
  }
  if (response.status === 403) {
    throw new Error("GitHub API 限流,请稍后重试");
  }
  if (!response.ok) {
    throw new Error(`GitHub API 返回 ${response.status}`);
  }

  const data = (await response.json()) as GithubRelease;
  cache = { repo: currentRepo, fetchedAt: now, data };
  return data;
}

/** 清除缓存(测试用)。 */
export function clearReleaseCache(): void {
  cache = null;
}
