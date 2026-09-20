# shelx 技术实施文档

| 项目 | 内容 |
| ------ | ------ |
| 文档版本 | v0.1(初稿) |
| 日期 | 2026-09-10 |
| 上游文档 | [PRD.md](./PRD.md) v0.1 |
| 工程规范 | 仓库根 AGENTS.md(分层、安全、质量门禁,与本档冲突时以 AGENTS.md 为准) |
| 任务清单 | [TODO.md](./TODO.md) |

---

## 1. 文档说明

本文档将 PRD 的产品需求落地为可执行的工程方案,覆盖:工程结构、依赖选型、后端/前端模块设计、IPC 契约、存储设计、关键流程时序、安全设计、测试与质量门禁、性能验证、风险预研。

实施顺序与任务粒度见 [TODO.md](./TODO.md);与 PRD 的有意偏差集中记录在 §14,评审时重点确认。

---

## 2. 总体架构与分层映射

### 2.1 架构总览

```
┌──────────────────── 前端(Next.js 静态导出,WebView)────────────────────┐
│  /(主工作区)              /settings(设置)        /overview(P1 总览)    │
│  侧栏连接树 │ 终端视图 │ 文件视图 │ 监控视图 │ 传输中心 │ 断线横幅/弹窗    │
│  stores(zustand) ── gateway(唯一 invoke/Channel 出口)                  │
└────────┬ command(请求/响应) ────────┬ ipc Channel(高频流) ──────────┘
         │                            │ 终端字节 / 传输进度 / 监控样本
┌────────▼────────────────────────────▼────────────────────────────────┐
│                        Rust 核心(Tauri 2)                             │
│  commands(薄适配) → application(用例) → domain(规则)                  │
│  infrastructure:ssh(russh) │ sqlite │ keyring │ fs │ settings(json)   │
└───────────────────────────────────────────────────────────────────────┘
```

核心原则(PRD 7.2):**一条 SSH 连接(一次认证)复用终端、SFTP、监控三类 channel**,连接级状态统一由 session 生命周期管理。

### 2.2 PRD 深模块 ↔ AGENTS.md 分层映射

| PRD 模块(7.3) | 落位(Rust 目录) | 职责要点 |
| ---------------- | ------------------ | ---------- |
| `ssh-transport` | `infrastructure/ssh/` | 唯一直接接触 russh 的模块:连接、认证、host key 校验、channel 开辟、keepalive |
| `session-manager` | `application/sessions/`(注册表/编排)+ `domain/session.rs`(状态机) | SessionId→会话映射、多终端路由、优雅关闭、重连 |
| `sftp-engine` | `application/transfers/`(队列/调度)+ `infrastructure/ssh/sftp.rs` | 文件操作 + 传输队列(并发、分块、进度、取消、冲突、重试) |
| `collector` | `application/monitoring/`(调度/差值/环形缓冲)+ `infrastructure/ssh/collector.rs`(命令拼装/解析) | 免 Agent 监控采集 |
| `conn-store` | `application/connections/` + `infrastructure/sqlite/` | 连接树/分组 CRUD、搜索、导入导出持久层 |
| `secret-store` | `infrastructure/keyring/` | 钥匙串存取、降级加密、引用管理 |
| `settings` | `application/settings/` + `infrastructure/settings/` | 应用设置与布局持久化 |

依赖方向(AGENTS.md §4):`commands → application → domain`,`infrastructure` 实现 application 定义的 port trait;`infrastructure/ssh` 不向上泄露 russh 类型。

---

## 3. 工程结构

### 3.1 目录树

```
.
├─ docs/                          # PRD、本档、TODO、后续 IPC 契约快照
├─ src/                           # 前端
│  ├─ app/                        # Next.js App Router(文件路由,静态导出)
│  │  ├─ layout.tsx               # 全局布局(主题、字体、Provider)
│  │  ├─ page.tsx                 # 主工作区(侧栏+标签栏+三视图+底部面板)
│  │  ├─ settings/
│  │  │  └─ page.tsx              # 设置页(Ctrl+, 打开)
│  │  ├─ overview/                # P1:多服务器总览
│  │  │  └─ page.tsx
│  │  └─ hooks/                   # 主工作区复用 hooks(use-sessions 等)
│  ├─ components/
│  │  ├─ ui/                      # shadcn/ui 生成组件
│  │  ├─ layout/                  # 侧栏、标签栏、状态点、分段控件
│  │  ├─ connection/              # 连接树、编辑对话框、快速连接、指纹/认证弹窗
│  │  ├─ terminal/                # xterm 封装、断线横幅、编码切换
│  │  ├─ files/                   # 双栏文件管理、chmod/冲突对话框
│  │  ├─ transfers/               # 传输中心
│  │  └─ monitor/                 # 监控图表组件
│  ├─ gateway/                    # Tauri IPC 唯一封装
│  │  ├─ tauri.ts                 # 全项目唯一 invoke/Channel/事件出口
│  │  └─ index.ts                 # 按域拆分的调用函数(connections/sessions/...)
│  ├─ stores/                     # zustand:tabs/sessions/transfers/layout/settings
│  ├─ services/                   # 前端服务(布局持久化、设置应用等)
│  ├─ lib/                        # cn()、格式化(bytes/duration)、i18n 字典、纯函数
│  └─ types/                      # IPC DTO 镜像类型 + 视图模型
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs                  # 仅启动 lib::run
│  │  ├─ lib.rs                   # Builder、插件、invoke_handler 注册
│  │  ├─ state.rs                 # AppState 组装与依赖注入
│  │  ├─ commands/                # 薄 command(每域一文件)
│  │  ├─ application/             # 用例 + ports(trait)
│  │  ├─ domain/                  # 实体、状态机、领域错误
│  │  ├─ infrastructure/          # ssh / sqlite / keyring / fs / settings
│  │  ├─ dto/                     # IPC 请求/响应 DTO(camelCase)
│  │  └─ shared/                  # 日志、路径、错误转换
│  ├─ capabilities/               # 最小权限声明
│  ├─ migrations/                 # SQLite 迁移 SQL
│  ├─ crates/shelx-codec/         # Rust→WASM:encoding_rs 封装(GBK 编码)
│  └─ tauri.conf.json
├─ tests/                         # Rust 集成测试(docker sshd)+ IPC 契约快照
└─ .github/workflows/ci.yml
```

> Next.js 版本以脚手架生成版为准;动手前按 AGENTS.md 要求阅读 `node_modules/next/dist/docs/` 中相关章节(静态导出、App Router)。

### 3.2 纪律要求(来自 AGENTS.md,实施时强制)

- 单文件非必要 ≤ 300 行;超限时按"域内子模块/子组件"拆分。
- 所有方法(Rust/TS)必须有 docstring;Rust 公共 API 写 rustdoc。
- 前端仅 `gateway/tauri.ts` 可触达 `@tauri-apps/api`;组件经路由目录 `api.ts` 或 `gateway/index.ts` 调用。
- 所有跨 IPC ID 一律 `string`;字段 camelCase(Rust 侧 serde `rename_all = "camelCase"`)。
- 小步提交(Conventional Commits),一次变更一个主题。

---

## 4. 依赖选型清单

### 4.1 Rust(src-tauri/Cargo.toml)

| 依赖 | 用途 | 备注 |
| ------ | ------ | ------ |
| tauri 2.x | 框架 | 不开多余 feature |
| serde / serde_json | 序列化 | |
| russh | SSH 客户端 | 版本以脚手架时最新稳定为准;密钥解析用内置 `russh::keys`(decode_openssh 等) |
| russh-sftp | SFTP | 与 russh 同生态 |
| tokio | 异步运行时 | features = "full" |
| rusqlite | SQLite | features = ["bundled"],WAL |
| keyring 4.x | OS 钥匙串 | Windows 凭据管理器 / macOS Keychain / Secret Service |
| machine-uid | 降级加密的机器指纹来源 | 见 §7.4 |
| aes-gcm / sha2 | 钥匙串不可用时的降级加密 | |
| uuid | ID 生成 | v4 + serde |
| thiserror | 结构化错误 | 领域/应用/基础设施错误建模 |
| tracing + tracing-subscriber + tracing-appender | 分级文件日志 | 默认 info,滚动 5MB×3 |
| tauri-plugin-dialog | 私钥文件选择、下载目录选择 | capability 白名单 |
| tauri-plugin-opener | 打开配置/日志目录、所在文件夹 | capability 白名单 |
| tauri-plugin-updater / process | 自动更新(M4) | 后置引入 |

### 4.2 前端(bun)

| 依赖 | 用途 |
| ------ | ------ |
| next / react / react-dom | 脚手架定版,`output: 'export'` 静态导出 |
| @tauri-apps/api | 仅 gateway 使用 |
| @tauri-apps/plugin-dialog / plugin-opener | 同 Rust 插件 |
| @xterm/xterm + addon-fit + addon-webgl(+ addon-search,P1) | 终端 |
| zustand | 客户端状态 |
| recharts | 监控图表(关动画) |
| @tanstack/react-virtual | 文件列表/传输中心虚拟滚动 |
| tailwindcss + shadcn/ui(Radix) | UI 体系,组件源码入库 |
| lucide-react | 图标 |
| vitest + @testing-library/react | 前端测试 |
| shelx-codec(本地 wasm 包) | GBK 编码;解码优先原生 `TextDecoder('gbk')`,编码方向(WASM)不可替代 |

---

## 5. 后端详细设计

### 5.1 领域层(`domain/`)

| 类型 | 内容 |
| ------ | ------ |
| `ConnConfig` / `Group` 值对象 | 字段即 PRD 6.2 对话框字段;构造时校验:名称/主机非空、端口 1–65535、用户名非空、认证方式与凭据字段匹配(私钥方式必须给路径或默认密钥;密码方式必须给密码或已存引用) |
| `SessionStatus` 状态机 | `Connecting → Online → Disconnected(reason)`;状态只能单向流动,重连 = 新会话周期 |
| `TransferStatus` 状态机 | `Queued → Preparing(目录展开/冲突预检) → AwaitingConflict? → Running → Completed \| Failed \| Canceled`;非法迁移 panic-free 拒绝 |
| `HostKeyRecord` | host+port → algorithm + SHA256 指纹;首次记录、变化即阻断(TOFU) |
| `MetricsSample` / `RawProcSample` | 差值计算 `RawProcSample → MetricsSample` 放在 domain(纯函数,可单测,呼应 PRD 7.7-5) |
| 领域错误 | `DomainError` 枚举,向上映射为应用错误与 IPC 错误码(§6.5) |

### 5.2 应用层与端口(`application/`)

服务(经 `state.rs` 以 `State<AppState>` 注入 command):

| 服务 | 用例 |
| ------ | ------ |
| `ConnectionService` | 连接/分组 CRUD、移动、复制、搜索(名称/主机/备注 ILIKE)、导入导出编排(P1) |
| `SessionService` | `connect(conn_id)`、`connect_quick(input)`、`close`、`reconnect`、状态查询;持有 `SessionRegistry`;terminal 路由(terminal_id → channel pump) |
| `TransferService` | 全局唯一传输队列:`enqueue_upload/download`、`cancel`、`retry`、`clear`、`respond_conflict`;两层并发(全局 2 任务 × 单任务 8 并发块) |
| `MonitorService` | `start(session, interval, channel)`、`stop`、`recent(session)`;每会话一个采集任务 |
| `SettingsService` | 设置/布局读写与变更通知 |

端口(trait,实现在 infrastructure,测试用 fake):

```rust
#[async_trait] pub trait ConnectionRepo { /* list/create/update/delete/move + host_key get/put */ }
pub trait SecretStore { fn put(&self, ref_key:&str, secret:&str) -> Result<()>; fn get(&self, ref_key:&str) -> Result<Option<String>>; fn delete(&self, ref_key:&str); fn availability(&self) -> KeyringAvailability; }
#[async_trait] pub trait SshTransport { async fn connect(&self, cfg:&ConnConfig, cb:TransportCallbacks) -> Result<Box<dyn SshSession>>; }
#[async_trait] pub trait SshSession { async fn open_pty(...); async fn open_sftp(...); async fn exec(...); async fn close(...); /* + on_disconnect 回调注册 */ }
pub trait SettingsStore { /* get/patch json */ }
```

### 5.3 基础设施层

#### 5.3.1 `infrastructure/ssh/`(russh 适配)

- `transport.rs`:建立 TCP+SSH(russh client config:超时 10s、算法默认);认证顺序按配置:
  - 密码:`authenticate_password`;
  - 私钥:`russh::keys::decode_openssh`(带口令)→ `authenticate_key`;
  - 键盘交互:`authenticate_user_interactive`,轮次经 `PromptBroker` 走前端模态框;
  - 免密:agent / 默认密钥路径(`~/.ssh/id_ed25519`、`id_rsa` 依次尝试)。
- `handler.rs`:实现 russh `client::Handler`:
  - `check_server_key`:计算 SHA256 指纹 → `ConnectionRepo` 查记录:无记录 → 经 `PromptBroker` 发 `hostkey-confirm` 事件等 `respond_hostkey_confirm`(120s 超时视为拒绝),同意则落库;不一致 → 返回 `HOSTKEY_MISMATCH` 终止连接;一致 → 放行。
  - 键盘交互 prompt → `PromptBroker` 发 `auth-prompt` 事件等 `respond_auth_prompt`(120s 超时)。
  - `disconnected` / EOF → 通知 `SessionService` 状态机置 Disconnected + 事件。
- `PromptBroker`:`HashMap<request_id, oneshot::Sender>`;命令 `respond_auth_prompt` / `respond_hostkey_confirm` 完成桥接。测试可用假 bridge 注入答案。
- keepalive:每 `keepaliveIntervalSecs`(默认 30,0=关)发送 russh keepalive 请求;连续 3 次无响应判定断线。
- `pty.rs`:开 pty channel(`request_pty` + shell),窗口变更转发 `window_change`。
- `sftp.rs`:同一连接开 SFTP subsystem channel,懒初始化、会话内复用;文件操作映射 SFTP 错误(`PERMISSION_DENIED`/`NOT_FOUND`/…,保留服务端消息原文)。
- `collector.rs`:监控命令拼装与解析,见 §9.5。

#### 5.3.2 终端输出泵(批处理,PRD 6.3 / 7.7-2)

每个 pty channel 一个 pump 任务:`channel.read → 缓冲 Vec<u8>`,满足任一条件即经绑定该终端的 ipc Channel 下发:**已缓冲 ≥ 64KiB** 或 **首字节滞留 ≥ 16ms**(用 tokio::select + 定时器实现)。payload 为原始字节(前端收到 `ArrayBuffer`),不 JSON 化、不字符串化,保证二进制与 TUI 程序正确性(PRD 7.7-1)。

> 预研项:若当前 Tauri 版本 Channel 原始字节路径有坑,降级为 `{terminalId, data: base64}`,见 §13-R3。

#### 5.3.3 其他适配器

- `infrastructure/sqlite/`:rusqlite + WAL + `foreign_keys=on`;迁移用 `PRAGMA user_version` 驱动,SQL 文件置于 `migrations/`。
- `infrastructure/keyring/`:service=`shelx`;钥匙串不可用(Linux 无 Secret Service 等)→ 降级:机器指纹(machine-uid)+ 盐 SHA-256 派生 AES-256-GCM 密钥加密落盘到数据目录,`KeyringAvailability::Degraded` 状态暴露给设置页显著提示(设置页展示"凭据存储:系统钥匙串/降级加密")。
- `infrastructure/fs/`:本地栏文件操作(列表/建/删/改名/家目录);路径规范化(`std::path::canonicalize` + 拒绝 NUL),操作均为用户显式动作触发,删除必须前端确认;不做 shell。
- `infrastructure/settings/`:配置目录下 JSON 读写(原子写:临时文件 + rename)。

### 5.4 并发模型

- 所有 SSH I/O 在 tokio 任务中;`SessionRegistry = RwLock<HashMap<SessionId, Arc<SshSessionState>>>`,锁内只做查改,不持锁做 I/O。
- 传输调度:`Semaphore(2)` 全局任务并发;每任务内部 `futures::stream` 以 8 个并发块请求写远端(SFTP write-at-offset)。
- 取消:`CancellationToken` per task;取消即停止读写,**保留 `.shelx-partial` 临时文件**(断点续传基础,P1)。
- 应用退出:关闭所有 session(channel close → 连接 close),进行中传输触发退出确认(前端 `onCloseRequested` 拦截)。

### 5.5 状态组装(`state.rs`)

```rust
pub struct AppState {
    pub connections: Arc<ConnectionService>,
    pub sessions:    Arc<SessionService>,
    pub transfers:   Arc<TransferService>,
    pub monitor:     Arc<MonitorService>,
    pub settings:    Arc<SettingsService>,
    pub prompt:      Arc<PromptBroker>,     // respond_* 命令直达
}
```

---

## 6. IPC 契约

### 6.1 通用约定

- 命名:snake_case **动词_资源**(AGENTS.md §4.2,如 `list_connections`);前端 gateway 方法为 camelCase 函数。
- 响应统一 `IpcResult<T>`:

```ts
type IpcResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };
```

- 所有 ID 为 `string`;时间戳 ms epoch(number);字节数 number。
- 高频流走 `ipc::Channel`(命令入参传入,绑定单一接收端);低频状态走全局事件;请求/响应走 command。

### 6.2 Commands 清单(P0 全量;标注 P1 的随 M4)

**连接与分组**

| 命令 | 参数 → 返回 |
| ------ | ------------- |
| `list_connections` | `() → ConnectionNode[]`(树:`{kind:'group', id, name, position, children[]} \| {kind:'conn', id, groupId, name, host, port, username, authMethod, hasStoredPassword, privateKeyPath?, hasStoredPassphrase, encoding, tagColor?, remark?, position}`;密码/口令本体不返回,仅布尔) |
| `create_connection` | `ConnectionInput → ConnectionDto`(下同) |
| `update_connection` | `{id, input} → ConnectionDto` |
| `delete_connection` | `{id} → void`(前端二次确认) |
| `duplicate_connection` | `{id} → ConnectionDto`(名称追加"(副本)") |
| `move_connection` | `{id, targetGroupId?, position} → void` |
| `create_group` | `{name, parentId?} → GroupDto`(P0 嵌套一层) |
| `rename_group` | `{id, name} → void` |
| `delete_group` | `{id, mode:'require-empty'\|'promote-children'} → void` |
| `move_group` | `{id, targetParentId?, position} → void` |
| `test_connection` | `QuickConnectInput → {latencyMs, serverInfo?}`(一次性连接 + `uname` 探测 + 断开;hostkey/键盘交互事件流程与正式连接一致) |

`ConnectionInput`:`{name, groupId?, host, port, username, authMethod:'password'|'privateKey'|'keyboard_interactive'|'agent', password?, passwordSave:'keyring'|'session'|'never', privateKeyPath?, passphrase?, passphraseSave, encoding:'utf-8'|'gbk', tagColor?, remark?}`

**会话与认证**

| 命令 | 参数 → 返回 |
| ------ | ------------- |
| `connect_session` | `{connId} → SessionInfo` |
| `connect_quick_session` | `QuickConnectInput → SessionInfo`(临时会话,不进连接树;`save:true` 时落库) |
| `close_session` | `{sessionId} → void` |
| `reconnect_session` | `{sessionId} → SessionInfo`(无可用凭据 → `AUTH_CREDENTIALS_REQUIRED`,前端弹输入) |
| `list_session_status` | `() → SessionInfo[]` |
| `respond_auth_prompt` | `{requestId, answers: string[]} → void` |
| `respond_hostkey_confirm` | `{requestId, accepted} → void` |

**终端**

| 命令 | 参数 → 返回 |
| ------ | ------------- |
| `open_terminal` | `{sessionId, cols, rows, onData: Channel<raw>} → {terminalId}`(Channel 绑定该终端,payload 原始字节 ArrayBuffer) |
| `write_terminal` | `{terminalId, data: Uint8Array} → void`(优先 raw invoke body) |
| `resize_terminal` | `{terminalId, cols, rows} → void`(→ pty window_change) |
| `close_terminal` | `{terminalId} → void`(断 channel) |

**SFTP 与传输**

| 命令 | 参数 → 返回 |
| ------ | ------------- |
| `remote_home_path` | `{sessionId} → string`(连接后定位远端主目录) |
| `list_remote_entries` | `{sessionId, path} → FileEntryDto[]` |
| `create_remote_dir` | `{sessionId, path} → void` |
| `rename_remote_entry` | `{sessionId, path, newName} → void` |
| `delete_remote_entries` | `{sessionId, paths: string[]} → {failed: [{path, message}]}[]`(递归;逐条结果,不静默) |
| `set_remote_permissions` | `{sessionId, path, mode: number} → void`(chmod) |
| `enqueue_upload` | `{sessionId, localPath, remoteDir, conflictPolicy, onProgress: Channel} → {taskId}`(目录自动递归展开) |
| `enqueue_download` | `{sessionId, remotePath, localDir, conflictPolicy, onProgress: Channel} → {taskId}` |
| `respond_transfer_conflict` | `{taskId, decision:'overwrite'\|'skip'\|'rename', applyToRemaining: boolean} → void` |
| `list_transfer_tasks` | `() → TransferTaskDto[]` |
| `cancel_transfer_task` | `{taskId} → void` |
| `retry_transfer_task` | `{taskId} → void` |
| `clear_transfer_tasks` | `{finishedOnly: boolean} → void` |

`FileEntryDto`:`{name, fileType:'dir'|'file'|'symlink'|'other', size, mtimeMs?, permissions: string, mode?: number, owner?}`

**监控**

| 命令 | 参数 → 返回 |
| ------ | ------------- |
| `start_monitor` | `{sessionId, intervalSecs, onSample: Channel<MetricsSample>} → void` |
| `stop_monitor` | `{sessionId} → void` |
| `recent_monitor_samples` | `{sessionId} → MetricsSample[]`(后端环形缓冲 1h,P1 回看 UI 用;P0 先落数据) |
| `list_remote_processes` | `{sessionId} → ProcessInfo[]`(P1) |

**设置 / 本地文件**

| 命令 | 参数 → 返回 |
| ------ | ------------- |
| `get_settings` / `update_settings` | `() → AppSettings` / `Partial<AppSettings> → AppSettings`(即时生效) |
| `get_layout` / `save_layout` | `() → LayoutState` / `LayoutState → void` |
| `get_update_notice` | `() → UpdateNotice \| null`(后台自动检查最近一次发现的通知;不发起网络请求,webview 刷新后恢复图标) |
| `open_app_dir` | `{target:'config'\|'logs'} → void`(opener 白名单) |
| `local_home_path` | `() → string` |
| `list_local_entries` | `{path} → FileEntryDto[]` |
| `create_local_dir` / `rename_local_entry` / `delete_local_entries` | 同远端语义(本地无 chmod) |
| `pick_local_folder` | `() → string \| null`(原生对话框) |

### 6.3 Channels(高频单向流)

| 流 | 方向 | payload | 频率 |
| ---- | ------ | --------- | ------ |
| 终端数据 | 后端→前端 | 原始字节 ArrayBuffer(绑定 terminalId) | 批处理 ≤16ms / ≤64KiB |
| 传输进度 | 后端→前端 | `{taskId, groupId?, state, transferredBytes, totalBytes, speedBps, error?}`(per-task channel) | 200ms 节流 |
| 监控样本 | 后端→前端 | `MetricsSample`(JSON,per-session channel) | 采样间隔 2–60s |

### 6.4 Events(低频广播)

| 事件 | payload |
| ------ | --------- |
| `session-status-changed` | `{sessionId, connId?, status:'connecting'\|'online'\|'disconnected', reason?}`(驱动标签圆点、横幅、监控置灰) |
| `auth-prompt` | `{requestId, sessionId?, title?, instructions?, prompts:[{text, echo}]}`(前端模态框,密码型 echo=false) |
| `hostkey-confirm` | `{requestId, host, port, algorithm, fingerprintSha256, firstSeen:true}`(指纹变化不经事件,直接 `HOSTKEY_MISMATCH` 错误+红色警告) |
| `app-update-available` | `{currentVersion, version, notes?, checkedAtMs}`(Rust 后台自动检查发现新版本;前端 store.applyNotice 点亮侧栏图标,手动检查/安装仍走前端 updater 插件链路) |

### 6.5 错误码(稳定枚举)

| code | 场景 |
| ------ | ------ |
| `VALIDATION_FAILED` | 参数校验失败 |
| `NOT_FOUND` | 连接/会话/终端/任务不存在 |
| `AUTH_FAILED` | 密码/私钥口令错误 |
| `AUTH_METHOD_REJECTED` | 服务器拒绝该认证方式 |
| `AUTH_CREDENTIALS_REQUIRED` | 重连时无凭据,需前端收集 |
| `HOSTKEY_MISMATCH` | 指纹变化,阻断(前端红色警告) |
| `HOSTKEY_REJECTED` | 用户拒绝/超时未确认首次指纹 |
| `NET_TIMEOUT` / `NET_UNREACHABLE` / `CONNECTION_REFUSED` | 网络层 |
| `SESSION_CLOSED` | 会话已断开 |
| `REMOTE_FS_ERROR` | SFTP 失败(details 带服务端消息原文) |
| `LOCAL_FS_ERROR` | 本地文件操作失败 |
| `STORAGE_ERROR` | SQLite/JSON 读写失败 |
| `KEYRING_UNAVAILABLE` | 钥匙串不可用且未允许降级 |
| `MONITOR_UNSUPPORTED` | 非 Linux 目标 |
| `INTERNAL` | 兜底(已脱敏,日志留痕) |

### 6.6 核心数据结构(契约形状)

```ts
SessionInfo   { sessionId, connId?, temporary?, status, serverInfo?: { hostname, os, kernel, arch } }
MetricsSample { ts, cpuPercent: number|null,          // 首个样本无差值 → null
                cpuCoresPercent: number[], memTotalKb, memUsedKb,
                swapTotalKb, swapUsedKb, netRxBytesPerSec, netTxBytesPerSec,
                disks: {mount, totalKb, usedKb}[], load1, load5, load15, uptimeSecs }
TransferTask  { taskId, groupId?, sessionId, connId?, direction:'upload'|'download',
                fileName, localPath, remotePath, totalBytes, transferredBytes,
                status:'queued'|'preparing'|'awaiting_conflict'|'running'|'completed'|'failed'|'canceled',
                speedBps?, error? }
AppSettings   { appearance:{theme:'system'|'dark'|'light', language:'zh'|'en'},
                terminal:{fontFamily, fontSize, lineHeight,
                          colorScheme:'default'|'dracula'|'tokyo_night'|'one_dark'|'nord'|
                                     'solarized_dark'|'solarized_light'|'github_light',
                          cursorStyle, encoding,
                          scrollback, copyOnSelect, rightClickPaste, confirmCloseTab},
                connection:{keepaliveIntervalSecs, defaultAuthMethod},
                transfer:{maxConcurrentTasks, chunkSizeKiB, defaultConflictPolicy, notifyOnComplete},
                monitor:{defaultIntervalSecs},
                update:{autoCheck} }
UpdateNotice  { currentVersion, version, notes?, checkedAtMs }   // app-update-available 载荷与 get_update_notice 返回共用
LayoutState   { sidebarCollapsed, sidebarWidth, bottomPanel:'sftp'|'transfers'|'hidden',
                bottomPanelHeight, tabView: Record<string, 'terminal'|'files'|'monitor'> }
ProcessInfo   { pid, user, cpuPercent, memPercent, rssKb, command }   // P1
```

---

## 7. 存储设计

### 7.1 目录布局(AGENTS.md §10 约定)

| 内容 | 路径 |
| ------ | ------ |
| SQLite | `~/.agents-plus/shelx/shelx.db` |
| 日志 | `~/.agents-plus/shelx/logs/shelx.log`(tracing-appender 滚动 5MB×3) |
| 降级加密凭据 | `~/.agents-plus/shelx/secrets.enc`(仅钥匙串不可用时) |
| 设置 | Tauri `app_config_dir()/shelx/settings.json` |
| 布局 | Tauri `app_config_dir()/shelx/layout.json` |
| 传输临时分片 | 目标同目录 `<name>.shelx-partial` |

路径一律经 Tauri path resolver / `dirs` 解析,禁止硬编码(AGENTS.md §10)。

### 7.2 SQLite DDL(migrations/0001_init.sql)

> 时间戳统一为 `INTEGER`(unix 毫秒);迁移以 `PRAGMA user_version` 版本化,SQL 内嵌于二进制。

```sql
PRAGMA journal_mode = WAL;

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22 CHECK(port BETWEEN 1 AND 65535),
  username TEXT NOT NULL,
  auth_method TEXT NOT NULL CHECK(auth_method IN ('password','private_key','keyboard_interactive','agent')),
  private_key_path TEXT,
  secret_ref_password TEXT,          -- 钥匙串引用键,非明文
  secret_ref_passphrase TEXT,
  encoding TEXT NOT NULL DEFAULT 'utf-8' CHECK(encoding IN ('utf-8','gbk')),
  tag_color TEXT,
  remark TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_connections_group ON connections(group_id);
CREATE INDEX idx_connections_name  ON connections(name);

CREATE TABLE host_keys (
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  algorithm TEXT NOT NULL,
  fingerprint TEXT NOT NULL,          -- SHA256 hex/base64 统一格式
  confirmed_at INTEGER NOT NULL,
  PRIMARY KEY (host, port)
);

CREATE TABLE transfer_history (       -- M2 落库
  id TEXT PRIMARY KEY,
  conn_id TEXT,
  direction TEXT NOT NULL,
  local_path TEXT NOT NULL,
  remote_path TEXT NOT NULL,
  total_bytes INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
```

迁移策略:`PRAGMA user_version` 递增,SQL 文件按序号入库,可重复执行(幂等 DDL)。

### 7.3 settings.json / layout.json

即 §6.6 `AppSettings` / `LayoutState` 原样(原子写)。设置变更后端广播 `settings-changed` 事件,已开终端提示"一键应用"。

### 7.4 钥匙串条目

- 引用键规则:`conn:<conn_id>:password`、`conn:<conn_id>:passphrase`。
- 删除连接:默认保留钥匙串条目;设置页提供"清理孤儿凭据"(比对 DB 引用,孤儿删除)。
- 降级加密:明文经 `AES-256-GCM(key = SHA256(machine_uid + "shelx-salt"))` 加密后写入 `secrets.enc`(JSON map),`availability=Degraded` 供设置页展示。

### 7.5 日志

tracing 分级 info 默认;不记录密码/口令/密钥内容与完整指纹明文(指纹可记);IPC 错误统一在 command 边界记录(脱敏 details)。

---

## 8. 前端详细设计

### 8.1 路由(src/app/,文件路由)

| 路由 | 内容 |
|------|------|
| `/` | 主工作区:侧栏连接树 + 标签栏 + 三视图(终端/文件/监控,分段控件 Alt+1/2/3)+ 底部面板(SFTP 双栏 / 传输中心,Ctrl+J) |
| `/settings` | 设置页(Ctrl+,),分组表单,即时保存 |
| `/overview` | P1:多服务器总览卡片 |

桌面单窗口应用无多页面导航需求,路由保持最小集;路由内 hooks/api 经 gateway,不直接 invoke。

**常驻外壳与浮层路由**:主工作区 UI 由根 layout 的 `AppShell` 常驻挂载(App Router layout 跨导航不重挂);`/settings`、`/overview`、连接表单等功能页由 layout 以全屏浮层(fixed inset-0)覆盖渲染。这样进入功能页不会卸载 `TerminalView`,终端 pty 通道、回滚缓冲与 SFTP 传输状态均保持;返回主页后焦点自动交还可见终端。`/` 路由本身渲染空内容,仅作为"无浮层"状态。传输冲突决策不迁路由,保持弹窗形态(PRD §6.4):`awaiting_conflict` 事件写入 ui store 的 `conflictTaskId`,由根 layout 挂载的 `TransferConflictDialog` 弹框收集四选决策。

### 8.2 gateway(`gateway/tauri.ts` + `index.ts`)

- 唯一 `invoke` / `Channel` / `listen` 出口;按域导出函数(`connections.list()`、`sessions.connect(id)`、`terminals.open(...)` 等)。
- 统一解包 `IpcResult`,抛 `IpcError{code, message, details}` 供 UI 分支(如 `HOSTKEY_MISMATCH` → 红色警告)。
- 终端数据 Channel 收到 ArrayBuffer → 直接交 xterm 解码写入,不进 zustand(性能)。

### 8.3 stores(zustand)

| store | 状态与更新源 |
| ------- | -------------- |
| `tabs` | 标签列表/激活 id/每标签视图;仅 UI 动作写 |
| `sessions` | `Record<sessionId, SessionInfo>`;由 `session-status-changed` 事件驱动 |
| `transfers` | `Record<taskId, TransferTask>`;由进度 Channel(200ms)与命令驱动 |
| `layout` | 侧栏/面板状态;本地即时更新 + 防抖 `save_layout` |
| `settings` | 启动 `get_settings` 拉取;变更乐观更新 + `update_settings` |

终端输出与监控样本不走全局 store:前者直写 xterm;后者在监控视图组件内 `useRef` 缓冲(720 点),采样间隔触发图表更新,避免全局 re-render。

### 8.4 关键组件方案

- **xterm 封装**(`components/terminal/`):ref 命令式组件;WebGL 渲染(失败降级 Canvas);addon-fit + ResizeObserver → `resize_terminal`;`onData`(Uint8Array)→ 编码 → `write_terminal`;Ctrl+滚轮缩放(5%–400%,持久化);选中即复制、右键粘贴可配;断线横幅复用连接状态。
- **双栏文件管理**(`components/files/`):本地/远程两列复用同一虚拟列表组件(TanStack Virtual,行高固定);目录优先 + 列头排序(名称中文 localeCompare);隐藏文件开关;多选/Ctrl+A/F2/Delete;拖入上传用 Tauri 窗口 `onDragDrop`(webview 层开启 dragDrop);右键下载 P0 兜底,拖出 P1。
- **传输中心**(`components/transfers/`):虚拟列表 + 进度条;groupId 折叠目录任务;全局速率由前端聚合 200ms 快照。
- **监控视图**(`components/monitor/`):Recharts 关闭动画;CPU 面积图+每核迷你条形;内存 used/buffers/cache 堆叠 + Swap 小图;网络双线 + Y 轴人类可读自动适配;磁盘进度条 >85% 橙 >95% 红;负载 1/5/15;断线置灰"采集已暂停"。
- **连接树**(`components/connection/`):shadcn Tree(自组合)+ 搜索过滤(名称/主机/IP/备注)+ 拖拽移动 + 右键菜单;双击连接开标签,单击选中。
- **弹窗组**:连接编辑 Dialog(shadcn Form)、快速连接、hostkey 确认、auth prompt(密码型输入遮蔽)、冲突决策、chmod 九宫格勾选、删除确认。

### 8.5 GBK 编码方案

- 解码:优先原生 `new TextDecoder('gbk')`(WebView2/WKWebView/WebKit 均实现 Encoding Standard);不可用时走 WASM 兜底。UTF-8 用 `TextDecoder('utf-8', {stream:true})` 保持跨 chunk 边界正确。
- 编码(用户输入→服务器):`TextEncoder` 仅 UTF-8,必须经 `shelx-codec` WASM(encoding_rs 封装)做 UTF-8→GBK。
- 切换编码:重置解码器状态后按新编码解码后续字节,不清屏(PRD 6.3)。

### 8.6 主题与 i18n

- 深色为主,Tailwind `dark` class + shadcn 语义令牌;`theme:'system'|'dark'|'light'`。
- i18n:`lib/i18n.ts` 字典(zh 默认,en M4);P0 只维护 zh 词条,键位结构预留。

---

## 9. 关键流程时序

### 9.1 连接与认证

```
UI: 双击连接 ─ connect_session(connId)
  app: conn_repo.get → secret_store.get(密码/口令;缺→AUTH_CREDENTIALS_REQUIRED 前端补收)
  infra: ssh connect → handler.check_server_key
      ├─ 无记录 → emit hostkey-confirm → (前端弹 SHA256 指纹框) → respond_hostkey_confirm
      │    ├─ 同意 → 落库,继续
      │    └─ 拒绝/120s 超时 → HOSTKEY_REJECTED
      └─ 有记录不一致 → HOSTKEY_MISMATCH(红色警告阻断)
  infra: authenticate
      ├─ 密码/私钥失败 → AUTH_FAILED / AUTH_METHOD_REJECTED(原地重试输入)
      └─ 键盘交互轮次 → emit auth-prompt → 前端模态框 → respond_auth_prompt → 下一轮
  app: registry.insert, status=Online → emit session-status-changed
       (后台一次性 exec 采 serverInfo: hostname/uname/os-release → 更新事件)
  → SessionInfo
```

### 9.2 终端数据流

```
输入: xterm.onData(bytes) → encode(UTF-8/GBK) → write_terminal → russh channel.write
输出: russh channel → pump 缓冲(≥64KiB 或 ≥16ms)→ ipc Channel(原始字节)
      → 前端 ArrayBuffer → decode(按连接编码,stream) → term.write(分块回调写,防冻结)
resize: ResizeObserver → fit addon → resize_terminal → pty window_change
```

### 9.3 断线与重连

```
EOF / keepalive×3 失败 → status=Disconnected(reason) → emit session-status-changed
  前端: 标签圆点变红 + 终端顶部横幅"连接已断开 · [重新连接]"(内容保留可复制)
  监控: 面板置灰"采集已暂停";SFTP: 传输任务失败/重试
reconnect_session: 有凭据(钥匙串/会话内存)→ 重走 9.1 → 新 channel 恢复视图;
  无凭据 → AUTH_CREDENTIALS_REQUIRED → 前端补收后重试
```

### 9.4 传输任务

```
enqueue_upload(local, remoteDir, policy)
  → walker 展开目录树(groupId) → 冲突预检(sftp stat)
      冲突且 policy='ask' → state=awaiting_conflict → 前端弹框(覆盖/跳过/保留两者/取消,
        可"应用到剩余") → respond_transfer_conflict
  → 全局队列(Semaphore 2) → Running:本地分块 32KiB,8 并发 write-at-offset
      写远端临时名 <name>.shelx-partial → 完成后 rename
      (覆盖决策:先删旧目标再 rename —— SFTP v3 SSH_FXP_RENAME 与
       Windows rename 在目标已存在时均失败;无 posix-rename 扩展时
       删除与改名之间的短暂窗口为协议固有限制。冲突应答会写回任务
       策略,自动重试沿用已答复决策,不重复弹框)
      进度 200ms 节流 → onProgress Channel
      网络类错误自动重试 2 次(指数退避)→ 仍败 → Failed(可手动 retry)
  取消 → CancellationToken → 保留 .shelx-partial(P1 断点续传基础)
```

### 9.5 监控采集

```
start_monitor(session, interval, channel)
  → collector 拼单次 shell(分隔符分段):
      echo ===S; cat /proc/stat; echo ===M; cat /proc/meminfo;
      echo ===N; cat /proc/net/dev; echo ===L; cat /proc/loadavg; cat /proc/uptime;
      echo ===D; df -P -k
  → 解析器产出 RawProcSample(fixtures 单测,见 §11)
  → domain 差值计算(vs 上次原始读数)→ MetricsSample(首个样本 cpuPercent=null)
  → 环形缓冲(cap = 3600s/interval)入队 + channel 推送
  断线 → 采集任务取消;重连 + 用户回到监控视图 → 清空重采(不拼接断档)
  首次执行前探测 /proc/stat 可读性,失败 → MONITOR_UNSUPPORTED(面板占位)
```

### 9.6 关闭确认

- 关标签:该连接存在 Running/Queued 传输 → 弹"取消传输并关闭 / 后台继续 / 取消";终端类按设置 `confirmCloseTab`。
- 关应用:窗口 `onCloseRequested` 前端拦截,有进行中任务列明数量确认。
- 说明:pty 无法感知远端前台进程,"运行任务"检测不做启发式猜测(PRD 偏差 §14-4)。

---

## 10. 安全设计

| 项 | 措施 |
| ---- | ------ |
| capability | 最小集:`core:default`、`core:event:default`、dialog(文件/目录选择)、opener(仅 `open_app_dir` 白名单路径)、updater(M4);禁止通配 |
| CSP | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'ipc: http://ipc.localhost'`;不加载任何远程资源 |
| 凭据 | 永不 IPC 返回明文;钥匙串优先;降级加密状态可见;连接 DTO 仅 `hasStored*` 布尔 |
| 路径 | 远端路径由 sftp 协议约束;本地路径规范化 + 拒绝空/NUL;本地删除必须前端确认 |
| 输入 | command 层 DTO 校验(长度/格式/范围);sftp 错误原文 toast 但截断超长消息 |
| 外部进程 | P0 无任何外部进程调用;"打开目录"仅经 opener 插件白名单 |
| 日志 | 脱敏:不落密码/口令/密钥;错误 details 在边界统一清洗 |
| 上报 | 无遥测、无云(PRD §8);CI 引入 `cargo audit` + `bun audit` |

---

## 11. 测试与质量门禁

### 11.1 组织

| 层 | 位置 | 内容 |
| ---- | ------ | ------ |
| Rust 单元 | `src-tauri/src/**` `#[cfg(test)]` | 领域校验/状态机迁移、collector 解析(真实 `/proc` 文本 fixtures:单核多核/缺字段/异常 df 行)、差值计算、冲突决策、降级加密 roundtrip、conn repo(临时目录 SQLite) |
| Rust 集成 | `tests/`(docker sshd:密码/私钥/OTP 三用户) | 认证三方式、host key 变化阻断、断连回调、命令超时、SFTP round-trip(哈希校验)、冲突策略、取消、并发调度、端到端采集冒烟 |
| IPC 契约 | `tests/ipc_contract.rs` | DTO JSON 序列化快照,防前后端漂移 |
| 前端 | `*.test.tsx`(vitest + RTL) | 终端组件(编码切换、断线横幅)、传输中心状态渲染、连接表单校验;只测用户可见行为 |

Windows 开发机无 docker:集成测试 `#[ignore]`,在 Linux CI/本地 WSL 跑;单元测试全平台。

### 11.2 质量门禁(每次提交前,AGENTS.md §9)

```bash
bun run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

### 11.3 CI(GitHub Actions)

- `frontend`:bun install → `next build`(静态导出成功即门禁)→ vitest run。
- `rust`(ubuntu,带 docker):fmt --check / clippy -D warnings / test(含集成)。
- `audit`:cargo audit + bun audit --audit-level high(允许失败初期可降级为提示)。

---

## 12. 性能预算与验证方法(PRD §8 对应)

| 指标 | 目标 | 验证方法 |
| ------ | ------ | ---------- |
| 按键回显 | < 30ms(局域网) | 脚本:注入按键 → 首字节回显时间戳,取 p95 |
| 大输出 | `yes`/百万行 cat 不冻结 UI | xterm 分块回调写 + 丢帧保护;手动基准 |
| 传输吞吐 | ≥ 同链路 sftp CLI 80% | M2 基准脚本:500MB 文件对比 `sftp`/`scp` |
| 内存 | 空闲 < 150MB;10 连接+监控 < 500MB | 10 会话 + 5s 采样跑 1h,记录 RSS 曲线 |
| 冷启动 | < 2s | 三平台安装包计时 |
| 大目录 | 1 万+ 条目 60fps | 虚拟列表 + 生成 2 万条目目录实测 |

---

## 13. 风险与预研(M1 首周各做半天级 spike)

| # | 风险 | 对策 |
| --- | ------ | ------ |
| R1 | russh 键盘交互 / host key 回调的异步桥接复杂 | PromptBroker + oneshot 先写原型验证;不行则 auth 阶段改同步轮询通道 |
| R2 | `TextDecoder('gbk')` 三平台 WebView 可用性 | M1 首周三平台各验一次;不可用则解码也走 WASM |
| R3 | ipc Channel 原始字节(ArrayBuffer)行为差异 | spike 验证;降级 base64 JSON(吞吐损失可接受,键盘输入不受影响) |
| R4 | WebView 拖出(drag-out)受限 | P0 已定拖入+右键下载;拖出 P1 视 WebView 能力,不行则放弃 |
| R5 | FinalShell 导入格式逆向 | 尽力解析 + 失败项列表,不承诺 100%(PRD §12-3) |
| R6 | Linux 无 Secret Service 的 keyring 环境 | 降级加密路径已设计;设置页显著提示 |
| R7 | WebGL 在旧 WebView2 不可用 | addon-webgl 失败自动 Canvas |
| R8 | next 静态导出 × Tauri devUrl 组合坑(端口占用、HMR 断连) | M0 脚手架即验证 dev/build 两形态 |
| R9 | 300 行文件上限 × 复杂视图 | 组件树拆分纪律 + CI 行数检查脚本(可选) |
| R10 | Windows 中文用户名/UNC 路径 | 全链路 PathBuf,IPC 边界 UTF-8;路径测试用例覆盖 |

---

## 14. 与 PRD 的偏差记录(评审重点)

| # | PRD 原文 | 本方案 | 理由 |
| --- | ---------- | -------- | ------ |
| 1 | 7.5 列出 `secrets.put/get/delete` 命令 | 不暴露通用 secrets 命令;凭据仅在 connect/test 入参内传输,后端直写钥匙串 | 缩小凭据 IPC 暴露面;前端无需读明文 |
| 2 | 7.5 命令命名 `connections.list` 风格 | snake_case 动词_资源(`list_connections`),遵循 AGENTS.md §4.2 | 工程规范优先 |
| 3 | 6.5/7.3 后端环形缓冲"历史回看 P1" | 环形缓冲 M3 即落地(数据先有),回看 UI 仍 P1 | 成本低,避免 P1 时补采逻辑 |
| 4 | 5.2-28 关闭"运行任务"终端确认 | 不做远端前台进程检测(pty 无信号可查),以"传输进行中 + 全局确认开关"近似 | 避免不可靠启发式误报/漏报 |
| 5 | 5.5-68 崩溃后恢复标签布局 | 列入 M4(P1 级) | 优先级表未入 P0 |
| 6 | 6.4 目录递归传输的"子树失败入队报告" | 失败项随 `delete/transfer` 结果结构返回 + 传输中心标红 | 交互一致,不额外发明报告页 |
| 7 | 6.7 "通用"分组含自动更新开关 | 开关落在独立"更新"分组(`update.autoCheck`);自动检查由 Rust 后台循环执行(10s 首查/4h 周期/5min 失败重试,事件 `app-update-available` 通知) | 检查与 UI 生命周期解耦,失败可观测可重试;分组独立便于后续扩展(如检查频率) |

> 契约变更流程:修改本文档 §6/§7 时同步更新 `docs/`(AGENTS.md §5),并补充 IPC 契约快照测试。
