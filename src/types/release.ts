/**
 * 应用版本与 GitHub Releases 类型(用于应用内版本检测)。
 *
 * 注意:这些类型不参与 IPC 契约(GitHub Releases 走外部 fetch,
 * 当前版本由 `AppVersion` 经 Tauri command 获取)。
 */

/** 当前应用版本号(由 Rust 编译期注入)。 */
export interface AppVersion {
  /** semver 字符串,如 `"0.2.0"`。 */
  version: string;
}

/** GitHub release 资源条目(仅取前端需要的字段)。 */
export interface GithubReleaseAsset {
  /** 文件名,如 `shelx-0.2.0-Windows.msi`。 */
  name: string;
  /** 下载直链。 */
  browser_download_url: string;
  /** 文件大小(字节);GitHub 不一定提供。 */
  size?: number;
  /** 内容类型。 */
  content_type?: string;
}

/**
 * GitHub `GET /repos/{owner}/{repo}/releases/latest` 响应子集。
 * 完整字段见 https://docs.github.com/en/rest/releases/releases#get-the-latest-release
 */
export interface GithubRelease {
  /** 形如 `v0.2.0`,前端应去掉前导 `v` 后与当前版本比较。 */
  tag_name: string;
  /** release 名称,可与 tag 相同。 */
  name: string | null;
  /** 是否为预发布。 */
  prerelease: boolean;
  /** 是否为 draft;GitHub 不会把 draft 暴露给 API,但字段保留。 */
  draft: boolean;
  /** 发布时间,ISO 8601。 */
  published_at: string | null;
  /** HTML 正文(Markdown 渲染源)。 */
  body_html: string;
  /** 原始 Markdown 文本;前端做简化展示时优先用这个。 */
  body: string;
  /** 静态下载资源。 */
  assets: GithubReleaseAsset[];
  /** release 页 HTML 链接(用户手动跳转用)。 */
  html_url: string;
}
