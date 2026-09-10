# shelx 开发 Todolist

| 项目 | 内容 |
|------|------|
| 上游 | [PRD.md](./PRD.md) / [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md) |
| 日期 | 2026-09-10 |

**完成定义(DoD,每个任务适用)**:代码带 docstring/注释、配套测试通过、§11.2 质量门禁全绿、小步提交(Conventional Commits)、涉及 IPC 契约时同步更新 TECHNICAL_DESIGN.md §6/§7 与契约快照测试。

**任务编号**:`Mx-B`=后端、`Mx-F`=前端、`Mx-T`=测试/验证、`Mx-S`=spike/预研。

---

## M0 工程脚手架(约 0.5 周)

- [ ] M0-1 初始化仓库:git、`.gitignore`(node/out/target/dist)、README、editorconfig
- [ ] M0-2 前端脚手架:bun + create-next-app(TS / App Router / Tailwind),改 `output: 'export'`;**动手前阅读 `node_modules/next/dist/docs/` 相关章节**(AGENTS.md 顶部要求)
- [ ] M0-3 Tauri 2 接入:`tauri.conf.json`(devUrl `localhost:1420`、frontendDist `../out`、beforeDevCommand `bun run dev`、beforeBuildCommand `bun run build`、窗口 1280×800 / min 960×600)
- [ ] M0-4 验证 dev/build 双形态(HMR 正常、静态导出产物可被 Tauri 加载)— 覆盖风险 R8
- [ ] M0-5 shadcn/ui 初始化 + 基础组件入库(button/dialog/dropdown-menu/input/form/select/switch/tabs/tooltip/sonner/scroll-area/context-menu)
- [ ] M0-6 前端依赖:zustand / recharts / @xterm/* / @tanstack/react-virtual / @tauri-apps/api + dialog/opener 插件 / lucide-react
- [ ] M0-7 Rust 骨架:`main.rs / lib.rs / state.rs / commands / application / domain / infrastructure / dto / shared` 目录 + 模块声明;tracing 文件日志(滚动);路径解析(`~/.agents-plus/shelx` 与 app config dir)
- [ ] M0-8 `gateway/tauri.ts` 唯一 invoke/Channel/listen 出口 + `IpcResult`/`IpcError` 类型与解包;`types/` IPC DTO 镜像
- [ ] M0-9 capabilities 最小集 + CSP(TECHNICAL_DESIGN §10)
- [ ] M0-10 CI workflow:frontend(bun build + vitest)/ rust(fmt/clippy/test,ubuntu+docker)/ audit
- [ ] M0-11 `lib/`(cn、format bytes/duration、i18n 字典骨架 zh)

**M0 验收**:`bun run build` + `cargo clippy -D warnings` 通过;`bunx tauri dev` 打开空壳窗口;CI 全绿。

---

## M1 连接管理 + SSH 终端(约 2 周)

### Spike(M1 首周内完成,各半天)

- [ ] M1-S1 russh 键盘交互 + host key 回调异步桥接原型(PromptBroker + oneshot)— R1
- [ ] M1-S2 三平台 WebView `TextDecoder('gbk')` 可用性验证 — R2
- [ ] M1-S3 ipc Channel 原始字节(ArrayBuffer)端到端验证 — R3
- [ ] M1-S4 xterm WebGL 在 WebView2 渲染验证(Canvas 降级路径)— R7

### 后端

- [ ] M1-B1 migrations 0001(groups/connections/host_keys,DDL 见 TECHNICAL_DESIGN §7.2)+ 迁移执行器(user_version)
- [ ] M1-B2 领域层:`ConnConfig`/`Group` 值对象与校验、`SessionStatus` 状态机、领域错误 + 单测
- [ ] M1-B3 `ConnectionRepo`(rusqlite)CRUD/移动/搜索 + 临时目录单测
- [ ] M1-B4 `SecretStore`(keyring put/get/delete + machine-uid+AES-GCM 降级 + availability)+ 双分支单测
- [ ] M1-B5 `ssh-transport`:connect(密码/私钥含口令/键盘交互/免密默认密钥)、host key TOFU(查库→事件确认→落库;不一致 `HOSTKEY_MISMATCH`)、`PromptBroker` 桥接、120s 超时
- [ ] M1-B6 `SessionService`:注册表、connect/connect_quick/close/reconnect、断线检测(EOF + keepalive×3)、`session-status-changed` 事件、serverInfo 一次性采集
- [ ] M1-B7 终端:open/write/resize/close command + pty channel + 输出泵(≤16ms/≤64KiB 批处理,raw bytes Channel)
- [ ] M1-B8 `SettingsStore`(settings.json/layout.json 原子写)+ `get/update_settings`、`get/save_layout`
- [ ] M1-B9 dto + commands 注册(connections/groups/sessions/terminals/settings 全集,TECHNICAL_DESIGN §6.2)+ 错误码映射(command 边界统一)
- [ ] M1-B10 集成测试(docker sshd:密码/私钥/OTP 用户):三种认证、指纹首次确认与变化阻断、服务端主动断连回调、连接超时

### 前端

- [ ] M1-F1 布局骨架:侧栏(宽度拖拽/折叠 Ctrl+B)、标签栏(+、关闭、状态圆点、Ctrl+T/Ctrl+W/Ctrl+Tab/Ctrl+数字)、三视图分段控件占位(Alt+1/2/3)、底部面板壳(Ctrl+J 显隐)
- [ ] M1-F2 `stores`:tabs/sessions/layout/settings;`session-status-changed` 事件接入(圆点联动)
- [ ] M1-F3 连接树:树渲染、搜索过滤(名称/主机/IP/备注)、拖拽移动、右键菜单、双击连接/单击选中
- [ ] M1-F4 连接编辑对话框(shadcn Form,字段=PRD 6.2;认证方式联动显隐;克隆;备注;标签颜色字段 P1 留位)
- [ ] M1-F5 hostkey 确认弹窗(算法+SHA256)、auth prompt 模态框(多 prompt、echo=false 遮蔽)
- [ ] M1-F6 快速连接弹窗(Ctrl+Shift+C):临时标签,可选保存
- [ ] M1-F7 xterm 封装:挂载/写入/fit+ResizeObserver→pty resize、Ctrl+滚轮缩放持久化、选中即复制/右键粘贴、分块回调写防冻结
- [ ] M1-F8 编码链路:shelx-codec WASM(utf-8↔gbk 编码 + 解码兜底)、按连接编码切换(即时生效不清屏)
- [ ] M1-F9 断线横幅(内容保留可复制)+ 手动重连;重连缺凭据时补收弹窗
- [ ] M1-F10 关闭标签确认(传输进行中 / confirmCloseTab 设置)
- [ ] M1-F11 设置页:通用(主题/语言占位)、终端(字体/字号/行距/光标/编码/缓冲行数/复制粘贴/关闭确认)、连接(keepalive/默认认证);设置对新终端生效
- [ ] M1-F12 深浅主题(默认跟随系统)+ 中文文案;布局持久化(防抖 save_layout,重启恢复)

### 测试/验证

- [ ] M1-T1 前端 RTL:编码切换、断线横幅、连接表单校验
- [ ] M1-T2 IPC 契约快照测试(M1 全部命令)
- [ ] M1-T3 手动清单:弱网断线重连、私钥带口令、OTP 服务器、GBK 服务器中文输出、按键回显 p95 < 30ms(局域网)

**M1 验收(PRD §10)**:能日常用它替代现有 SSH 客户端干活。

---

## M2 SFTP + 传输中心(约 2 周)

### 后端

- [ ] M2-B1 SFTP channel 管理:懒初始化、会话内复用、断线清理;`remote_home_path`
- [ ] M2-B2 文件操作命令:list/mkdir/rename/delete(递归,逐条结果)/setstat(chmod)+ SFTP 错误码映射(保留服务端消息)
- [ ] M2-B3 传输引擎:全局队列(Semaphore=2,设置可调)、分块 32KiB × 8 并发 write-at-offset、`.shelx-partial` 临时名 + 完成改名
- [ ] M2-B4 冲突状态机:预检 → awaiting_conflict → `respond_transfer_conflict`(overwrite/skip/rename + applyToRemaining);默认策略来自设置
- [ ] M2-B5 目录递归:walker 展开 + groupId 关联;子树失败逐条上报
- [ ] M2-B6 进度 Channel 200ms 节流;网络类错误自动重试 2 次(指数退避);取消(CancellationToken,保留分片)
- [ ] M2-B7 `transfer_history` 落库 + `list/cancel/retry/clear_transfer_tasks`
- [ ] M2-B8 本地栏命令:local_home/list/mkdir/rename/delete/pick_local_folder(dialog 插件)
- [ ] M2-B9 集成测试(docker sshd):上传下载 round-trip 哈希校验、目录树递归、冲突四策略、取消留分片、并发调度、失败重试、超大目录 list 分页性能

### 前端

- [ ] M2-F1 双栏框架:本地/远程复用虚拟列表组件(TanStack Virtual)、连接后自动进入远端主目录
- [ ] M2-F2 文件列表:列(图标/名称/大小人类可读/权限/修改时间)、目录优先 + 列头排序(中文 locale)、隐藏文件开关、单击选中/Ctrl/Shift 多选/Ctrl+A、F2/Delete/Enter、右键菜单
- [ ] M2-F3 路径栏:面包屑 + 直接输入跳转 + 前进/后退历史;刷新不丢选择;变更后自动刷新
- [ ] M2-F4 拖入上传(Tauri onDragDrop,含文件夹);右键下载(P0 兜底);拖出下载留 P1(R4)
- [ ] M2-F5 传输中心:任务列表(方向/文件名/路径/大小/进度/速度/ETA/状态/取消/重试)、groupId 折叠、全局速率汇总、完成后清除、失败标红
- [ ] M2-F6 冲突对话框(覆盖/跳过/保留两者/取消 + 应用到剩余)
- [ ] M2-F7 chmod 对话框(owner/group/other × r/w/x 九勾选)
- [ ] M2-F8 关闭标签/退出应用时有进行中传输的确认流(取消并关闭 / 后台继续 / 取消)
- [ ] M2-F9 SFTP 错误 toast(服务端消息原文,超长截断),不静默失败
- [ ] M2-F10 设置-传输组(并发任务数/分块大小/冲突默认策略/完成通知)

### 测试/验证

- [ ] M2-T1 前端 RTL:传输中心各状态渲染、冲突对话框分支
- [ ] M2-T2 吞吐基准:500MB 单文件 vs `sftp` CLI,目标 ≥ 80%(风险项,不达标调分块/并发)
- [ ] M2-T3 手动清单:2 万条目目录 60fps、弱网(丢包 20%)传输与重试、与 MobaXterm/WinSCP 互传

**M2 验收(PRD §10)**:与 MobaXterm/WinSCP 互传验证吞吐达标。

---

## M3 服务端监控(约 1 周)

### 后端

- [ ] M3-B1 collector 命令拼装(单 shell 调用 + `===` 分隔符,见 TECHNICAL_DESIGN §9.5)+ 执行超时(5s)
- [ ] M3-B2 解析器:stat/meminfo/netdev/loadavg/uptime/df -P,真实 `/proc` fixtures 单测(单核多核、缺 meminfo 字段、异常磁盘行、容器环境)
- [ ] M3-B3 domain 差值计算(总 CPU + 每核、网络速率)+ 首样本 cpuPercent=null 处理
- [ ] M3-B4 `MonitorService`:start/stop 命令、interval 立即生效、环形缓冲(1h/interval)、`recent_monitor_samples`、Channel 推送
- [ ] M3-B5 断线联动:采集任务随会话取消;重连后清空重采;非 Linux 目标探测 → `MONITOR_UNSUPPORTED`
- [ ] M3-B6 对容器 sshd 的端到端采集冒烟测试

### 前端

- [ ] M3-F1 监控视图骨架:顶部信息条(主机名/发行版/内核/架构/uptime/用户)、采样间隔下拉(2/5/10/30/60s 立即生效)
- [ ] M3-F2 图表网格(Recharts,关动画):CPU 面积图 + 每核迷你条形;内存 used/buffers/cache 堆叠 + Swap 小图;网络双线(自适应 Y 轴 + 人类可读单位);磁盘进度条(>85% 橙 / >95% 红);负载 1/5/15
- [ ] M3-F3 断线置灰"采集已暂停,等待重连",重连自动恢复
- [ ] M3-F4 视图内样本缓冲(useRef,不进全局 store)+ 切回视图时经 `recent_monitor_samples` 补历史

### 测试/验证

- [ ] M3-T1 解析/差值单元测试全绿(fixtures 覆盖边界)
- [ ] M3-T2 手动:真实服务器连续采集 24h,观察内存无泄漏(PRD 验收)

**M3 验收(PRD §10)**:对真实服务器连续采集 24h 无泄漏。

---

## M4 P1 补全 + 发布(约 2 周)

### 功能补全(P1)

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

- [ ] M4-R1 应用图标与视觉规范(**PRD 未定项,开发前确认**)
- [ ] M4-R2 tauri-plugin-updater 接入(自动更新开关,可关闭)
- [ ] M4-R3 三平台安装包(Windows nsis/msi、macOS dmg、Linux AppImage/deb)+ 干净安装/升级验证
- [ ] M4-R4 开源定案:License(Apache-2.0 或 GPL-3.0)、数据格式审计文档(凭据与连接存储说明)
- [ ] M4-R5 诊断打包:一键导出脱敏日志(可观测性要求)

### 验证

- [ ] M4-V1 性能预算逐项复测(TECHNICAL_DESIGN §12 全表,含三平台冷启动 < 2s)
- [ ] M4-V2 安全自查:capability 最小化复查、CSP 复查、路径穿越用例、密钥不入日志 grep 检查
- [ ] M4-V3 PRD §9 手动测试清单全量:弱网 20% 丢包、服务器重启、指纹变化告警、GBK 服务器、10 连接+监控 1h 内存曲线、三平台安装包
- [ ] M4-V4 IPC 契约文档与快照测试全量核对(v1.0 基线)

**M4 验收(PRD §10)**:v1.0 发布。

---

## 持续事项(每个里程碑迭代执行)

- [ ] 提交前质量门禁四连(TECHNICAL_DESIGN §11.2)
- [ ] CI 全绿(含 docker sshd 集成测试)
- [ ] 依赖漏洞扫描(cargo audit / bun audit)
- [ ] 文档同步:IPC 契约变更 → TECHNICAL_DESIGN §6/§7 + 快照测试
- [ ] 手工验证记录(涉及窗口/权限/打包/平台差异时,AGENTS.md §9)
