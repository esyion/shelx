/**
 * 应用内更新相关类型。
 *
 * 自动检查由 Rust 后台完成:发现新版本时经 `app-update-available` 事件
 * 推送本结构,`get_update_notice` command 也返回同形数据
 * (与 Rust 端 `application::update::UpdateNotice` 对应,契约单一来源)。
 * 手动检查/安装仍走 `@tauri-apps/plugin-updater` 前端链路。
 */

/** 当前应用版本号(由 Rust 编译期注入)。 */
export interface AppVersion {
  /** semver 字符串,如 `"0.2.0"`。 */
  version: string;
}

/** 可用更新通知(Rust 后台自动检查结果)。 */
export interface UpdateNotice {
  /** 当前应用版本。 */
  currentVersion: string;
  /** 可用的新版本号(无 `v` 前缀)。 */
  version: string;
  /** Release notes(Markdown 源);插件未返回或为空白时为 null。 */
  notes: string | null;
  /** 检查时刻(unix 毫秒)。 */
  checkedAtMs: number;
}
