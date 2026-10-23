<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/shelx.svg">
    <img src="public/shelx-light.svg" alt="shelx" height="40">
  </picture>
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <a href="https://github.com/esyion/shelx/releases/latest"><img src="https://img.shields.io/github/v/release/esyion/shelx" alt="latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
</p>

# shelx

终端、文件、监控——0.3 起，再加一个会替你干活的助手。

做这个东西，是因为市面上的终端工具越做越满。隧道、插件市场、远程桌面、抓包、各种会话日志……对有的人有用。我自己每天真正点开的，大概就是 80% 用户都会用到的那一块：连上去敲命令、传几个文件、看一眼 CPU 和磁盘。一个窗口够了。助手也守同一条规矩：它只用你已经配置好的 SSH 连接干活，每一步都摆在你眼前，写操作必须等你点头。

界面布局借鉴了 [FinalShell](https://www.finalshell.net.cn/)：左边连接树，顶上标签，同一个工作区里切终端 / 监控 / 文件。这个结构我用了很久，到现在还是最顺手的。致谢 FinalShell。

```
┌──────────────┬─────────────────────────────────┬────────────┐
│ 连接树       │  标签栏                          │            │
│              ├─────────────────────────────────┤  AI 助手   │
│  CPU / 内存  │  终端 · 监控 · 进程 · 文件       │  (停靠,    │
│  / 磁盘      ├─────────────────────────────────┤   可收起)  │
│              │  传输中心                        │            │
└──────────────┴─────────────────────────────────┴────────────┘
```

Windows / macOS / Linux 桌面应用。目前界面是中文。

## 安装

到 [Releases](https://github.com/esyion/shelx/releases/latest) 下最新包：

| 平台 | 下这个 |
| --- | --- |
| Windows x64 | `*-setup.exe`（NSIS） |
| macOS Apple Silicon | `*_aarch64.dmg` |
| macOS Intel | `*_x64.dmg` |
| Linux x64 | `.deb` / `.rpm` / AppImage |

安装包还没做苹果 / 微软签名。macOS 被 Gatekeeper 拦住时：右键 → 打开，或系统设置 → 隐私与安全性 → 仍要打开。

装好之后会自己查 GitHub Releases，并用 minisign 校验安装包。有新版本时，侧栏箭头会变蓝。

## SSH

双击左边的主机就能连。密码、OpenSSH 私钥、键盘交互（OTP），或者「用我本机已有的 SSH 配置」——ssh-agent 加默认密钥（依次试 `~/.ssh/id_ed25519`、`id_ecdsa`、`id_rsa`）。Windows 上 agent 先找 `openssh-ssh-agent`，再找 Pageant。

第一次连会弹出 SHA-256 主机指纹，确认后记下（TOFU）。shelx 自己管已知主机库，不碰你的 `~/.ssh/known_hosts`。指纹以后变了会直接拒绝，不会默默覆盖。默认 30 秒 keepalive，连续 3 次没响应才断。

终端是 xterm.js——GPU 正常走 WebGL，不正常退回 DOM 渲染。默认选中即复制、右键粘贴，OSC 52 也在；剪贴板全走原生通道，因为 WebView 总爱拒绝网页版。`Ctrl` + 滚轮改字号。内置 7 套配色（Dracula、Tokyo Night、One Dark、Nord、Solarized Dark / Light、GitHub Light）；字体、行距、光标、回滚缓冲都在设置里，改了对已开的终端立刻生效。中文输入法有专门的护栏，拼音不会再碎成 `f rf ree -h`。每个连接可选 UTF-8 或 GBK，照顾国内老机器。

一条 SSH 会话扛终端、文件、监控、进程四块。来回切视图，pty 不会拆掉。断线时缓冲还在，能看能复制，横幅上有重连按钮。

## 文件

双栏：左本地、右远端。列表、建目录、重命名（`F2`）、删除（`Del`）、显示隐藏文件、按名称 / 大小 / 修改时间排序；改权限是九宫格勾选，不用记八进制数字。列表做了虚拟滚动，上万条目照样顺滑。文件拖进窗口，进当前远端目录。右键上传 / 下载。

进度在底部传输中心（`Ctrl+J`）：速度、剩余时间、取消、重试。同名会问你——覆盖、跳过、还是两个都留——可以勾「对剩余冲突同样处理」。默认并发 2。网络失败退避重试两次；取消会留下 `.shelx-partial` 分片。窗口不在前台时，传完会用系统通知喊你。

## 监控

只支持 Linux 服务器。走同一条 SSH 读 `/proc`——一次采样一条 shell 命令，Rust 侧解析。不装 agent，不走 SNMP，服务器上什么都不用装。

CPU（环形图 + 每核）、内存 / Swap、网速、磁盘、负载（带空闲 / 正常 / 繁忙的状态徽标）、运行时间。磁盘超过 85% 变橙，95% 变红。侧栏底下有一条紧凑的条——磁盘也在里面；工作区里是图表。采集跟着会话走，不跟着视图走：切标签不打断，最近一小时随时回看（5 分 / 15 分 / 30 分 / 1 小时窗口）。采样间隔 2 / 5 / 10 / 30 / 60 秒。不是 Linux 会明说不支持，不会编数字。

进程是独立的工作区标签——任务管理器式的表格（名称、用户、PID、状态、CPU%、内存、累计时间），每列都能排序，带过滤框。当前 CPU% 按两次快照差分算，跟 `top` 一个算法——因为 `ps` 报的是生命周期平均。杀进程先确认，给你看完整命令行，发的是 SIGTERM——没有那种并不存在的「强制结束」假选项。

还有一个总览页：每台已连的主机一张卡，CPU / 内存 / 网速一眼扫完。监控视图可以置顶，边敲命令边盯。

## AI 助手

AI 面板停靠在右侧——挤压工作区而不是盖住它，收起也不打断正在跑的一轮。你用大白话描述问题，它从连接列表里挑主机（需要的话自己连），跑命令、读文件、tail 日志，答案把证据贴在正文里。

- **只说两种协议，故意的**：OpenAI Responses 和 Anthropic Messages。`/chat/completions` 不支持——老协议带不动这需要的推理流和工具流。自定义 base_url 可以用；OpenAI 形态的网关必须先实测通过 `{base_url}/responses` 才准保存，因为多数兼容网关只会 chat completions，等任务跑到一半才失败更糟。模型名和上下文窗口随包内置目录下发，可按接入点覆盖。
- **十三个工具**：列主机、主机详情、建连、系统信息、执行命令、读文件、列目录、tail 日志、写文件、删除、重命名、chmod、记记忆。
- **审批闸门**：只读命令（白名单判定——`nginx -t` 算只读，`nginx` 不算）在默认模式下直接跑；写操作逐台等你三选一——本次允许 / 本对话 + 本主机 + 本工具一直允许 / 拒绝。10 分钟不回应按拒绝算。命令一律走 argv 数组——没有 shell 字符串、没有管道、没有重定向；还有更严的两档：每条命令都问、或只挂只读工具。
- **跨主机批量**：按分组、按当前在线、或全部已配置主机选目标。并发上限在设置里管，每台单独批准，结果按主机分列，一台失败不停其余。
- **记忆**：助手可以提议记笔记——全局的或按主机的——但你批准才落，疑似凭据的内容直接拒写。
- **会话**：存在 SQLite 里，每轮回放成一条有序时间线——思考、步骤、答案——不是一堆折起来的日志。哪个会话正等你批准，侧栏角标会提醒你。
- **计量与密钥**：上下文用量表显示模型窗口用了多少，背后还有单对话 token 预算闸门。API Key 只进系统钥匙串——不进 SQLite、不进日志、不进 IPC。

## 桌面规矩

「关闭到托盘」（可选）让 SSH 和 SFTP 会话在窗口关掉后继续活着，从托盘恢复或退出。二次启动——包括浏览器或文档里点 `ssh://user@host:port` 拉起的那次——只会把已有窗口带到前台，顺手预填快速连接。窗口大小位置都记得住。开机自启是个设置项。全局呼出快捷键（档位选择，在快捷键页管理）随时把窗口唤到最前。主题是一处真相三处同步：设置、界面、原生标题栏。

## 连接

左边那棵树就是地址簿。分组、搜索、拖着排、备注。右键连接、编辑、克隆、删除。克隆只拷主机配置，不拷凭据。表单里可以先测试连接再保存，失败不丢你填的东西。

密码不进 SQLite。进系统钥匙串（Keychain / Credential Manager / Secret Service）。钥匙串不可用时，退到 `~/.shelx` 下一份 AES-GCM 加密文件。也可以只在本次会话里记住，或者干脆不存。

没有跳板机，没有端口转发，没有插件。是故意的。

## 设置

设置页由后端拥有的契约驱动渲染：有哪些控件、区间多大、什么档位、什么单位——Rust 侧校验写入用的就是同一份 schema。带未知字段的补丁会被拒绝而不是悄悄丢掉，所以不会出现「设置看着能改、实际永远无效」。保存即时生效；被拒绝的保存保留你的输入并把原因说清楚。分组：通用、终端、传输、监控、窗口、AI、快捷键、数据。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Ctrl+,` | 设置 |
| `Ctrl+B` | 侧栏 |
| `Ctrl+J` | 传输中心 |
| `Ctrl+W` | 关标签 |
| `Ctrl+Tab` | 下一个标签 |
| `Alt+1` / `2` / `3` / `4` | 终端 / 监控 / 进程 / 文件 |
| `Ctrl` + 滚轮 | 终端字号 |

## 从源码编

需要 [Rust](https://rustup.rs/)、[Bun](https://bun.sh/)，以及对应系统的 [Tauri 2 依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/esyion/shelx.git
cd shelx
bun install
bun tauri dev      # 开发
bun tauri build    # 打安装包
```

数据在 `~/.shelx`（库、日志、降级凭据）。设置和窗口布局在系统的应用配置目录（`com.krmeow.shelx`）。

技术栈：Tauri 2、russh、russh-sftp、rig（Agent 循环）、SQLite、系统钥匙串。前端是 Next.js 静态导出 + xterm.js + shadcn/ui + Zustand。

## 引擎盖下

- Rust 侧严格分层——command → application → domain，基础设施走端口 trait——不开窗口也能测。
- IPC 契约是生成的，不是手抄的：Rust DTO 导出 JSON Schema，`bun run gen:ipc` 编译成 TypeScript，`check:ipc` 一漂移就让 CI 红掉。前端想悄悄手写一份后端类型都做不到。
- 260+ 个 Rust 测试、一套容器化 sshd 的认证 / 传输 round-trip 集成测试，外加覆盖用户可见行为的 vitest 套件。依赖漏洞扫描进了 CI。
- 无遥测、无账号、无云。设计文档（PRD、技术设计、Agent 设计、IPC 契约）在 [`docs/`](docs/)。工程规范是 [`AGENTS.md`](AGENTS.md)，提 PR 的短路径在 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 致谢

布局直接学的 **FinalShell**。用过的人，十秒内就知道东西在哪。

Bug 和想法走 [Issues](https://github.com/esyion/shelx/issues)。怎么改代码见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题走 [SECURITY.md](.github/SECURITY.md)，不要公开提。

## 许可证

[MIT](LICENSE)。© 2026 [esyion](https://github.com/esyion)
