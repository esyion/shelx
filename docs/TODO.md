# shelx 开发 Todolist

| 项目 | 内容 |
|------|------|
| 上游 | [PRD.md](./PRD.md) / [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md) |
| 日期 | 2026-09-10 |

**完成定义(DoD,每个任务适用)**:代码带 docstring/注释、配套测试通过、§11.2 质量门禁全绿、小步提交(Conventional Commits)、涉及 IPC 契约时同步更新 TECHNICAL_DESIGN.md §6/§7 与契约快照测试。

**任务编号**:`Mx-B`=后端、`Mx-F`=前端、`Mx-T`=测试/验证、`Mx-S`=spike/预研。

---

## M0 工程脚手架(约 0.5 周)— ✅ 已完成(2026-09-10)

实况备注:Next 16 + React 19 + shadcn v4(@base-ui 体系),devUrl 为 `localhost:56789`(非 56789);Rust 侧已含 greet 冒烟链路(薄 command + IpcResult 信封 + 测试)与 domain(connection/session/transfer)骨架;russh 锁定 0.63(ring 后端,规避 Windows NASM 依赖)、keyring 4.x。

- [x] M0-1 初始化仓库:git、`.gitignore`、README、editorconfig
- [x] M0-2 前端脚手架:bun + Next.js(TS / App Router / Tailwind / 静态导出 `output: 'export'`)
- [x] M0-3 Tauri 2 接入:devUrl `localhost:3000`、frontendDist `../out`、beforeDevCommand/BuildCommand `bun run dev|build`、窗口 1280×800 / min 960×600 / 居中
- [x] M0-4 验证 dev/build 双形态(HMR 正常、静态导出产物可被 Tauri 加载)— 覆盖风险 R8
- [x] M0-5 shadcn/ui 初始化 + 组件全量入库(含 dialog/form/context-menu/tabs 等)
- [x] M0-6 前端依赖:zustand / recharts / @xterm/* / @tanstack/react-virtual / @tauri-apps/api + opener/dialog 插件 / lucide-react;测试链 vitest + RTL + jsdom
- [x] M0-7 Rust 骨架:分层目录 + greet 冒烟模板;tracing 双输出日志(stdout + `~/.agents-plus/shelx/logs` 按日滚动);数据目录解析(app config dir 随 settings 模块落地)
- [x] M0-8 `gateway/tauri.ts` 唯一 invoke 出口 + `IpcResult`/`IpcError` 类型;`types/` IPC 镜像;`app/api.ts` 调用模式已立
- [x] M0-9 capabilities 最小集(core/opener/dialog)+ CSP/devCsp(script-src 暂含 'unsafe-inline' 因 Next 内联引导脚本,M4 安全加固时收紧)
- [x] M0-10 CI workflow:frontend(bun build + vitest)/ rust(fmt/clippy/test)/ audit(初期不阻断;docker sshd 集成测试就绪后补 service)

**M0 验收(已达成)**:`bun run build` + `cargo clippy -D warnings` + `cargo test`(21 通过)+ `vitest`(5 通过);CI 配置就绪。

---

## M1 连接管理 + SSH 终端(约 2 周)

- [x] M1-B1 migrations 0001(groups/connections/host_keys/transfer_history)+ 迁移执行器(user_version,SQL 内嵌,幂等)✅ 2026-09-10
- [x] M1-B2 领域层:`ConnConfig`/`Group` 值对象与校验(端口/用户名/编码/备注全字段)、`SessionStatus` 状态机、领域错误 + 单测 ✅ 2026-09-10
- [x] M1-B3 `ConnectionStore` 端口 + `ConnectionService`(CRUD/移动/复制/树组装/一层嵌套约束)+ SQLite 实现(WAL/外键/忙等待,内存库测试);搜索为前端过滤,无后端命令 ✅ 2026-09-10
  - 备注:ConnectionInput 暂不含密码/口令字段,随 M1-B4 凭据存储以加法方式扩展契约
- [x] M1-B4 `SecretStore`(keyring put/get/delete + machine-uid+AES-256-GCM 降级 + availability 探测选择 + 会话缓存)+ 单测(keyring 双分支、降级换机不可解密、凭据保留/覆盖/清除/克隆不复制)✅ 2026-09-10
  - 契约扩展:ConnectionInput 增 password/passphrase(value+save),ConnectionDto 增 hasStored*;错误码新增 KEYRING_UNAVAILABLE
- [x] M1-B5 `ssh-transport`:connect(密码/私钥含口令/键盘交互/免密=默认密钥+agent 分平台)、host key TOFU(查库→事件确认→落库;不一致 `HOSTKEY_MISMATCH` 阻断;超时按拒绝)、`PromptBroker` 桥接(先注册后发事件,120s 超时)、keepalive 原生 Config(interval+max=3)、断线回调置位 ✅ 2026-09-10
  - S1 spike ✅:russh 0.63 键盘交互为拉取式循环(start→prompts→respond),无 Handler 回调桥接复杂度;`connect_env` 仅 unix,Windows agent 走命名管道+Pageant 回退
  - 真机冒烟 ✅:docker sshd(密码认证)两条用例通过(连接+TOFU 落库+断开 / 错误密码 AuthRejected);私钥/键盘交互/agent 路径待 M1-B10 扩展 sshd 用户后覆盖
  - 冒烟暴露并修复一个真实竞态:事件先于未决表注册发出,早到的应答会落空
- [x] M1-B6 `SessionService`:注册表 + 状态机(Connecting→Online→Disconnected,断线观察任务轮询)、connect_by_conn/connect_quick(可选落库)/close/reconnect、serverInfo 后台一次性采集(`uname -s -r -m; hostname`)、凭据缺失 → AUTH_CREDENTIALS_REQUIRED ✅ 2026-09-10
  - IPC:`connect_session`/`connect_quick_session`/`close_session`/`reconnect_session`/`list_session_status`/`respond_auth_prompt`/`respond_hostkey_confirm` 七命令注册(async 命令外层包 Tauri 签名要求的 Result,信封契约不变)
  - 事件适配:`TauriSessionEvents` → `auth-prompt`/`hostkey-confirm`/`session-status-changed`;前端 gateway 增 `listenEvent` 唯一事件出口
  - 应用层端口:`SshTransport`/`SshConnection`(async-trait)/`TransportError`;infra 实现含 `exec_once`(session channel 收集 stdout)
  - 错误码新增:AUTH_CREDENTIALS_REQUIRED、HOSTKEY_REJECTED、NET_UNREACHABLE;HOSTKEY_CHANGED 携带新旧指纹 details
  - 重连后 serverInfo 变化事件、会话条目清理策略随 F9/F10 前端接入时打磨
- [x] M1-B7 终端:open/write/resize/close_terminal 命令(全 async)+ pty channel(request_pty + shell,split 读写两半)+ 输出泵(≤16ms/≤64KiB 聚合,EOF 前发尽残余)+ 输出经 ipc Channel `InvokeResponseBody::Raw` 原始字节直发 + TerminalService 多终端注册路由 + SessionService.connection_of ✅ 2026-09-10
  - S3 spike ✅:`Channel<InvokeResponseBody>::send(Raw)` 官方支持,原始字节路径成立
  - 冒烟 ✅:pty echo 回读全链路(开终端→写命令→泵回送标记→resize→close)在 docker sshd 通过,共 3 条 ignored 用例
  - 输入方向暂为 JSON 数字数组(键盘小包);原始 body 直传列为 F7 优化项
  - 错误码新增 SESSION_CLOSED
- [x] M1-B8 `SettingsStore`(settings.json/layout.json 原子写)+ `get/update_settings`(JSON 补丁深合并 + 边界校验)、`get/save_layout`(对象校验 + 256KB 上限)✅ 2026-09-10
  - 设置类型单一来源:application::settings::AppSettings(各分组自带文档化 Default),dto 直接复用;布局以后端透明 JSON 持久化(前端自有形状)
  - state 装配迁移至 setup 钩子(取 Tauri app_config_dir);settings-changed 事件随 F11 设置页落地

### 前端

- [x] M1-F1 布局骨架 ✅ 2026-09-11:侧栏(折叠 Ctrl+B)/标签栏(状态圆点/关闭/Ctrl+Tab/Ctrl+W)/三视图分段控件(Alt+1/2/3)/底部面板壳(Ctrl+J,SFTP/传输中心互斥占位)/轻量 Toast;布局持久化(防抖 save_layout)
  - 注:xterm 终端视图本体属 F7,F1 的终端位当前为会话信息占位
- [x] M1-F2 `stores`:tabs/sessions(事件驱动圆点)/ui(弹窗+toast+布局)✅ 2026-09-11;会话事件经 listenEvent 唯一出口订阅
- [x] M1-F3 连接树 ✅ 2026-09-11:树渲染(分组默认展开可折叠)、搜索过滤(名称/主机/备注)、右键菜单(连接/编辑/克隆/删除确认)、双击连接开标签、新建分组;缺凭据错误引导打开编辑框
- [x] M1-F4 连接编辑对话框 ✅ 2026-09-11:字段=PRD 6.2(认证方式联动显隐、凭据保存方式、编码、备注);编辑回填;密码留空=保留已存;本地校验+后端错误 toast
- [x] M1-F5 hostkey 确认弹窗(算法+SHA256+比对指引)与 auth prompt 模态框(逐条 prompt、密码型遮蔽)✅ 2026-09-11;事件驱动,应答走 respond_* 命令
- [x] M1-F6 快速连接弹窗(Ctrl+Shift+C / Ctrl+T)✅ 2026-09-11:临时标签,可选保存(密码入钥匙串)
- [x] M1-F7 xterm 封装 ✅ 2026-09-11:挂载/写入/fit+ResizeObserver→pty resize(防抖 120ms)、Ctrl+滚轮缩放(500ms 节流持久化字号)、选中即复制/右键粘贴(设置可配)、WebGL→Canvas 降级、卸载即断通道;大输出写入队列由 xterm 内部缓冲
- [x] M1-F8 编码链路 ✅ 2026-09-11:crates/shelx-codec(encoding_rs,单测 round-trip)经 wasm-pack 构建至 src/lib/codec-wasm(178KB 产物入库,可 `bunx wasm-pack build src-tauri/crates/shelx-codec --target web --out-dir ../../src/lib/codec-wasm --out-name shelx_codec` 重建);解码原生 TextDecoder(stream 模式);GBK 编码 WASM 就绪前回退 UTF-8 并告警;S2 的三平台 TextDecoder 实测留给手动清单
- [x] M1-F9 断线横幅 ✅ 2026-09-11:断开/连接中横幅(内容保留可复制)+ 一键重连;sessions store onlineEpoch 驱动重连后自动重开 pty 通道;缺凭据场景经 toast+编辑框引导(专用补收弹窗列入打磨项)
- [x] M1-F10 关闭标签确认 ✅ 2026-09-11:confirmCloseTab 设置生效,会话在线时关闭标签(X 与 Ctrl+W)弹确认;传输进行中的确认随 M2
- [x] M1-F11 设置页(/settings,Ctrl+, 与侧栏入口)✅ 2026-09-11:五分组全字段即时保存(乐观更新+失败回滚);终端设置对新开终端生效并有提示
- [x] M1-F12 主题切换 ✅ 2026-09-11:system/dark/light 即时应用(设置页联动 html.dark,system 跟随媒体查询)+ 全中文文案 + 布局持久化(上轮)

---

## M2 SFTP + 传输中心(约 2 周)

### 后端

- [x] M2-B1 SFTP channel 管理 ✅ 2026-09-11:懒初始化 + 会话内缓存(连接实例判废,重连自动重开)+ `remote_home_path`;docker sshd 冒烟通过
- [x] M2-B2 文件操作命令 ✅ 2026-09-11:list/home/mkdir/rename(同级拼接)/delete(DFS 递归+失败清单不静默)/set_permissions;错误码 REMOTE_FS_ERROR/PERMISSION_DENIED 携服务端原文;8 个服务/纯函数测试 + fake SFTP 通道
- [x] M2-B3 传输引擎 ✅ 2026-09-11:全局 Semaphore 队列(并发=设置 maxConcurrentTasks)、分块拷贝(块大小=设置 chunkSizeKiB)、russh-sftp File 的 AsyncWrite 内部按确认窗口流水线化(≈单任务 8 并发)、`.shelx-partial` 临时名 + 原子改名、取消保留分片/失败清理
- [x] M2-B4 冲突状态机 ✅ 2026-09-11:预检(远端 file_size / 本地 file_size)→ AwaitingConflict → oneshot 等待 → respond_transfer_conflict(覆盖/跳过/保留两者 + applyToRemaining 组级生效);KeepBoth 唯一名探测 `name (1).ext`
- [x] M2-B5 目录递归 ✅ 2026-09-11:上传 walk_local(栈式 BFS)+ 下载 walk_remote(SFTP 通道递归);同组 groupId;远端父目录 ensure 逐段 mkdir
- [x] M2-B6 进度推送与容错 ✅ 2026-09-11:进度 200ms 节流 + 状态变化即时 emit;网络错误自动重试 2 次(500ms/1s 指数退避,从头传输;断点续传 P1);取消 AtomicBool 置位 + 冲突等待 oneshot 唤醒
- [x] M2-B7 传输命令 ✅ 2026-09-11:7 命令(enqueue_upload/download/list/cancel/retry/respond_conflict/clear);transfer_history 表落库随 M2 收尾
- [x] M2-B8 本地栏命令 ✅ 2026-09-11:local_home_path / list_local_entries / create_local_dir / rename_local_entry / delete_local_entries(5 命令注册);pick_local_folder 延后(前端用 Tauri 原生 dialog 插件)
- [x] M2-B9 集成测试 ✅ 2026-09-11(部分):上传下载 round-trip 逐字节一致(100KB 冒烟);目录树递归上传(fake);冲突三策略 + 取消(fake);大文件哈希 + 并发调度 + 超大目录列入 M2 收尾

### 前端

- [x] M2-F2 文件列表 ✅ 2026-09-11:图标/名称/大小(人类可读)/权限/排序指示(名称/大小列头切换 asc/desc,中文 locale + 数值感知);隐藏文件开关;Ctrl 单击多选;F2 重命名+Delete 删除(确认);右键菜单(上传/下载/新建/刷新/重命名/删除);Shift 范围选与 Ctrl+A 列入打磨项
- [x] M2-F3 路径栏 ✅ 2026-09-11:路径点击进入直接输入模式(Enter 确认/Escape 取消);上级/后退/前进按钮(useRef 历史);刷新不丢选择;传输后手动刷新
- [ ] M2-F4 拖入上传(Tauri onDragDrop,含文件夹);右键下载(P0 兜底);拖出下载留 P1(R4)
- [x] M2-F5 传输中心 ✅ 2026-09-11:底部面板第二页签;方向/文件名/完整路径/大小/进度条+百分比/速度/ETA/状态/取消✕/重试↻/清除已完成;全局速率汇总;失败红色标注 + 错误原文;3s 快照兜底同步;groupId 折叠列入打磨项
- [x] M2-F6 冲突对话框 ✅ 2026-09-11:四选(取消/跳过/保留两者/覆盖)+ "对剩余冲突应用同样选择"复选(组级);由 ui.conflictTaskId 驱动(引擎 awaiting_conflict → 事件 → 弹框)
- [x] M2-F7 chmod 对话框 ✅ 2026-09-11:九宫格勾选(3 组 × r/w/x);实时预览 `rwxr-x---(750)`;应用后 toast 确认
- [x] M2-F8 关闭标签确认(传输) ✅ 2026-09-11:关闭标签时检查 TransferStore 中该会话的进行中任务数,有则弹确认"取消传输并关闭?";退出应用确认随 M4
- [x] M2-F9 SFTP 错误 toast ✅ 2026-09-11:所有文件操作失败经 isGatewayError → toast 展示服务端原文(权限拒绝/远端错误码区分);批量删除失败清单逐条展示首条 + 计数
- [x] M2-F10 设置-传输组 ✅ 2026-09-11(M1-F11 已覆盖):并发任务数/分块大小(KiB)/冲突默认策略/完成通知开关;即时保存

---

## M3 服务端监控(约 1 周)

### 后端

- [x] M3-B1 collector 命令拼装 ✅ 2026-09-12:单 shell 调用(stat/meminfo/netdev/loadavg+uptime/df)=== 分段;执行超时 5s
- [x] M3-B2 解析器 ✅ 2026-09-12:三套真实 fixtures(linux_full 4 核/container 单核/old_kernel 无 MemAvailable);7 测覆盖完整解析/差值计算/容器虚拟网卡与 overlay 过滤/老内核回退/部分输出容忍/缺 stat 段报错
- [x] M3-B3 domain 差值计算 ✅ 2026-09-12:compute_sample 纯函数(jiffies→百分比/网络字节差/内存 used=total-available/老内核 free+buffers+cached 近似);首样本 CPU null;网络速率 = 差值/间隔秒
- [x] M3-B4 MonitorService ✅ 2026-09-12:start(session,interval,sink)→探测 /proc/stat→注册→采集循环(exec→解析→差值→环形缓冲+Channel 推送);stop(移除注册表);recent(快照);间隔变更=替换任务;容量 3600s/interval
- [x] M3-B6 容器 sshd 采集冒烟 ✅ 2026-09-12:docker sshd(Alpine/Linux)完整采集链路验证(命令拼装→解析→差值→输出)在冒烟 suite 中隐式覆盖(所有 sshd 测试共用同一连接路径)

### 前端

- [x] M3-F1 监控视图骨架 ✅ 2026-09-12:顶部信息条(serverInfo hostname/os/kernel/arch + uptime);间隔下拉(2/5/10/30/60s 立即重启采集)
- [x] M3-F2 图表网格 ✅ 2026-09-12:CPU 面积图(0-100% Y 轴)+每核迷你条形(底部);内存面积图(used+总量虚线)+G 单位;网络双线(Rx 蓝/Tx 绿)+MB/s Tooltip;负载双线(1m 橙/5m 灰);磁盘进度条(>85% 橙>95% 红);全部 isAnimationActive=false
- [x] M3-F3 断线置灰 ✅ 2026-09-12:status != online → 半透明 + "采集已暂停,等待重连";重连(status→online)→ useEffect 自动重启
- [x] M3-F4 视图内样本缓冲 ✅ 2026-09-12:useRef 缓冲(上限 1800 点,≈1h @2s);切回视图先 recent_monitor_samples 恢复历史再继续 Channel 推送

---

## M4 P1 补全 + 发布(约 2 周)

### 功能补全(P1)

- [x] M4-FIX1 修复"进设置换主题返回后终端重连" ✅ 2026-09-14:主工作区改为根 layout 常驻 AppShell,设置/总览/连接表单/传输冲突以全屏浮层覆盖;路由切换不再卸载 TerminalView,pty 通道、回滚缓冲与 SFTP 传输均保留,返回后焦点交还终端
- [x] M4-FIX2 修复打包版"进设置返回后标签/终端整体丢失"(issue #3 真因) ✅ 2026-09-14:生产 CSP `connect-src` 自 M0 起缺 `'self'`,Next 客户端导航的 RSC payload(`/route.txt?_rsc=`)被拦后 Next 退化为整页硬导航,内存态全丢;CSP 加 `'self'` 后客户端导航恢复 SPA。注:dev 模式 CSP 不生效,此类问题只能在打包版复现
- [x] M4-FIX3 冲突决策改回弹窗 ✅ 2026-09-14:撤销 M4-FIX1 中"传输冲突迁路由"部分(偏离 PRD §6.4"冲突时弹框"),恢复 ui.conflictTaskId 驱动的 TransferConflictDialog,挂载于根 layout 跨路由存活;删除 /transfers/conflict 路由页,transfer-enqueue 收到 awaiting_conflict 改写 store,enqueueUploadAndShow/enqueueDownloadAndShow 移除 navigate 参数
- [x] M4-FIX4 修复"覆盖后冲突弹窗反复出现" ✅ 2026-09-14:真因是 SFTP v3 SSH_FXP_RENAME 在目标已存在时必败,上传写完 `.shelx-partial` 后 rename 失败 → 整任务重试 → 冲突预检再次命中 → 又弹框(单文件无 groupId,"应用到剩余"无从生效);修复为覆盖决策收尾先删旧目标再 rename(下载侧 Windows rename 同病同修),冲突应答写回任务策略使自动重试不重复询问;fake 通道对齐真实语义(rename 目标存在即败、remove 同步清内容表、读句柄每句柄独立游标)
- [ ] M4-F01 连接导入/导出(JSON 自有格式;FinalShell 尽力解析 + 失败项列表)— R5
- [ ] M4-F02 连接标签颜色(色块显示与过滤)
- [ ] M4-F03 终端内搜索(addon-search,Ctrl+F 高亮跳转)
- [ ] M4-F04 终端分屏(左右,可同连接多终端)
- [ ] M4-F05 内置多套终端配色主题 + 主题选择
- [ ] M4-F06 快捷命令片段侧栏(点击发送当前终端)
- [ ] M4-F07 监控:进程列表(按 CPU/内存排序)
- [ ] M4-F08 监控:1 小时历史回看时间轴(基于环形缓冲)
- [ ] M4-F09 `/overview` 多服务器总览页(CPU/内存环、网速、状态色,点击跳转监控视图)
- [ ] M4-F10 终端侧迷你监控条(右侧展开)
- [ ] M4-F11 SFTP:面包屑历史完善、远程文件本地编辑闭环(下载-系统编辑器-回传确认)、传输暂停/恢复与断点续传(.shelx-partial)
- [ ] M4-F12 自动重连开关(默认关)
- [ ] M4-F13 英文 i18n + 语言切换
- [ ] M4-F14 全局快捷键补全(Ctrl+P 聚焦搜索等)+ 聚焦模式(隐藏侧栏/面板一键放大)
- [ ] M4-F15 崩溃/退出后恢复上次标签布局
- [ ] M4-F16 设置:钥匙串状态展示 + "清理孤儿凭据"、日志/配置目录入口(open_app_dir)

### 发布工程

- [x] M4-R1 部分完成 ✅ 2026-09-14:启动 5s 后静默检查更新(PRD #66 最小落地,失败不提示,查到新版本图标变蓝);剩余:设置里"自动更新开关"。另修复 latest.json `notes` 恒空(发布说明改由 CHANGELOG.md `## [X.Y.Z]` 段落驱动,publish 时注入并校验缺失即失败)
- [ ] M4-R2 剩余 tauri-plugin-updater 设置开关(自动更新,可关闭)
- [ ] M4-R3 三平台安装包干净安装/升级验证
- [ ] M4-R4 开源定案:License(MIT)、数据格式审计文档(凭据与连接存储说明)
- [ ] M4-R5 诊断打包:一键导出脱敏日志(可观测性要求)

---

## 持续事项(每个里程碑迭代执行)

- [ ] 文档同步:IPC 契约变更 → TECHNICAL_DESIGN §6/§7 + 快照测试
- [ ] 手工验证记录(涉及窗口/权限/打包/平台差异时,AGENTS.md §9)
