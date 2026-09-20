# 自动检查更新迁移到 Rust 端

## 背景与目标
现状：唯一自动检查是 `layout.tsx` 启动 5 秒后的一次性定时器，失败即终局（无重试/无日志），导致新版本发布后图标不变蓝、用户点一下才检查。目标：自动检查整体迁到 Rust 后台任务（启动延时 + 周期 + 失败重试 + 事件通知前端），并按 PRD #66 补「自动检查更新」设置开关。**手动检查/安装保持现有 `@tauri-apps/plugin-updater` 前端链路不动。**

## 检查调度策略（mod.rs 顶部常量，可调）
- 启动后 10s 首查（避开启动期网络/代理未就绪）；成功后每 4h 复查；失败 5min 后重试。
- 每轮检查前读 `settings.update.autoCheck`，关闭则跳过本轮（不发包）。
- 仅「发现新版本」时 emit 事件；up-to-date 与失败只记 tracing 日志。

## Rust 端改动（照 monitoring/events/sqlite 现有惯例）

1. **`application/update/mod.rs`（新增）**
   - `UpdateNotice { current_version, version, notes: Option<String>, checked_at_ms: u64 }`，`#[serde(rename_all = "camelCase")]`（事件载荷与 command 响应共用，同 ports.rs 的 SessionStatusEvent / dto/settings.rs 的「契约单一来源」惯例）。
   - 端口：`#[async_trait] UpdateChecker { async fn check(&self) -> Result<Option<UpdateNotice>, UpdateCheckError> }`、`UpdateEventSink { fn available(&self, notice: &UpdateNotice) }`。
   - `UpdateAutoCheckService { checker, events, settings: Arc<SettingsService>, last_notice: StdMutex<Option<UpdateNotice>>, 三个时长常量 }`：
     - `spawn()` 用 `tauri::async_runtime::spawn` 跑 `loop { sleep(run_once().await) }`（照 monitoring run_loop 风格，不持锁跨 await）；
     - `run_once()` 读开关 → 检查 → emit/存 last_notice/打日志 → 返回下次间隔（纯逻辑可单测）。
2. **`application/update/tests.rs`（新增）**：FakeChecker（脚本化结果）+ CapturingSink，覆盖：有更新→emit+last_notice+短间隔；无更新→不 emit；失败→重试间隔；开关关→checker 零调用。
3. **`infrastructure/updater.rs`（新增）**：`TauriUpdateChecker { app: AppHandle }` 实现 `UpdateChecker`，内部用 `tauri_plugin_updater::UpdaterExt` 的 `updater_builder().check().await`，映射 `Update{version, body, current_version}` → `UpdateNotice`。与前端插件的手动 check 互不干扰（各自独立 Update 对象）。
4. **`infrastructure/events.rs`**：加 `EVENT_UPDATE_AVAILABLE = "app-update-available"`（kebab-case 对齐 `session-status-changed`）+ `TauriUpdateEvents` 适配器（emit 失败 `tracing::warn!` 不阻断）。
5. **`application/settings/mod.rs`**：新增 `UpdateSettings { auto_check: bool }`（`#[serde(rename_all="camelCase", default)]` + Default=true），`AppSettings` 加 `update: UpdateSettings` 字段——serde default 保证旧设置文件兼容；bool 无需 validate 分支。
6. **`dto/update.rs`（新增）**：`pub use crate::application::update::UpdateNotice;`；**`commands/update.rs`（新增）**：`get_update_notice() -> IpcResult<Option<UpdateNotice>>` 读 `state.updates.last_notice`（供 webview 刷新后恢复图标状态），本地 `to_ipc_error`，`lib.rs` 注册。
7. **`state.rs`**：`AppState` 加 `updates: Arc<UpdateAutoCheckService>`，`initialize` 末尾组装并 `spawn()`。

## 前端改动

8. **`gateway/tauri.ts`**：加 `APP_UPDATE_EVENTS = { available: "app-update-available" }`。
9. **`gateway/update.ts`**：加 `getUpdateNotice()`（走 `invokeUnwrapped`）；现有插件封装不动。`gateway/index.ts` 补 re-export（该文件有未提交的 opener 改动，只做增量编辑不触碰其区域）。
10. **`types/release.ts`**：死类型 `UpdateInfo` 替换为 `UpdateNotice`；`types/settings.ts` 加 `UpdateSettings` + `AppSettings.update`。
11. **`stores/update.ts`**：加 `applyNotice(notice)`（置 status=available + 版本/notes/lastCheckedAt）；`init()` 末尾追加 `getUpdateNotice()` → 有则 `applyNotice`（webview 刷新恢复）。
12. **`app/layout.tsx`**：删除 5 秒定时器块（L73-79）；在同个 useEffect 里按 statusChanged 的既有模式订阅 `APP_UPDATE_EVENTS.available` → `applyNotice`。
13. **`app/settings/page.tsx`**：新增「更新」分组，`SwitchRow`「自动检查更新」照「传输完成通知」的写法走 `updateSettings` patch。
14. **`sidebar.tsx` 不动**：图标/弹窗/手动检查照旧（事件把 status 置为 available 后图标自然变蓝，弹窗打开时的重新检查仍会走插件拿最新数据）。

## 文档与门禁

- `docs/TECHNICAL_DESIGN.md`：IPC 表加 `get_update_notice` 与 `app-update-available` 事件、settings 分组补 update。
- `docs/PRD.md`：按记忆规则回写 #66 的实现方式（Rust 后台检查/周期/重试/开关落点）。
- 门禁：`bun run build`、`cargo fmt --check`、`cargo clippy --all-targets --all-features -- -D warnings`、`cargo test`。

## 手工验证清单
1. dev 启动：~10s 出现首查 tracing 日志；屏蔽网络（断网/改 endpoints）时每 5min 重试日志、不崩溃、图标保持灰、手动检查路径正常。
2. 临时把 endpoints 指向含新版本的测试 latest.json：不点击图标即变蓝，弹窗版本/说明正确。
3. 设置页关闭开关 → 重启 → 日志确认不发包；打开 → 恢复检查。
4. 应用内 Ctrl+R 刷新 webview：init 拉取 last_notice，图标恢复蓝色。