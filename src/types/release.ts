/**
 * 应用更新与元信息契约类型:来自 Rust 生成物(`gen/update.ts`、`gen/appMeta.ts`)。
 *
 * 自动检查由 Rust 后台完成:发现新版本时经 `app-update-available` 事件推送,
 * `get_update_notice` 返回同形数据;手动检查/安装仍走前端 updater 插件链路。
 */
export type { UpdateNotice } from "./gen/update";

/** 当前应用版本号(由 Rust 编译期注入)。 */
export type AppVersion = import("./gen/appMeta").AppVersionDto;
