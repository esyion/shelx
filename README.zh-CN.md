<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" alt="shelx 图标" />

# shelx

**SSH 终端 · 文件管理 · 实时监控 · AI 运维助手,一个轻量桌面应用全搞定**

[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Release](https://img.shields.io/github/v/release/esyion/shelx?display_name=tag&include_prereleases)](https://github.com/esyion/shelx/releases)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/esyion/shelx/releases)

[English](README.md) | [简体中文](README.zh-CN.md)

</div>

---

shelx 是一款开源的跨平台服务器管理工具:一条 SSH 连接同时承载终端、SFTP 文件管理和免 Agent 的实时监控,并内置一个可审批、可回溯的 AI 运维助手,能用自然语言在你配置的主机上取证和操作。

所有数据都留在本地:连接信息存在本地数据库,凭据进系统钥匙串;没有账号、没有云同步、没有任何遥测上报。

## 截图

| 实时监控 | 进程列表 |
|:---:|:---:|
| ![监控](public/1.png) | ![进程](public/2.png) |

| 双栏文件管理(SFTP) | AI 助手 · 操作记录 |
|:---:|:---:|
| ![文件](public/3.png) | ![AI 助手](public/4.png) |

## 功能

### 连接管理

- 分组连接树 + 即时搜索,支持备注和彩色标签
- 密码、私钥(含口令)、键盘交互(OTP)、ssh-agent 四种认证方式
- 凭据存入系统钥匙串(Windows 凭据管理器 / macOS Keychain / Linux Secret Service),可选"仅本次会话"或"不保存"
- 首次连接确认主机指纹(TOFU),指纹变化时阻断连接并醒目告警
- 快速连接不落任何配置;浏览器里的 `ssh://` 链接可直接唤起并预填

### SSH 终端

- 多标签终端,同一连接可开多个终端(多 channel)
- xterm.js + WebGL 渲染;端到端字节流,UTF-8 / GBK 即时切换,老服务器中文不再乱码
- keepalive 心跳、标签上的连接状态圆点、断线横幅一键重连且保留回滚缓冲
- 主题、Ctrl+滚轮缩放字号、选中即复制、缓冲区行数可配

### 实时监控(免 Agent)

- 服务器无需安装任何 agent 或脚本,通过 SSH 只读命令解析 `/proc` 采集
- CPU(总占用 + 每核)、内存与 Swap、网络速率、各挂载点磁盘、负载 1/5/15、运行时长
- 采样间隔与时间窗可调,会话内历史曲线可回看
- 断线自动暂停,重连后自动恢复
- 进程列表支持筛选和按 CPU / 内存 / 累计 CPU 时间排序

### 文件管理(SFTP)

- 本地 ⇄ 远程双栏浏览器:排序、隐藏文件、面包屑、路径直达
- 拖拽上传下载,后台传输队列、实时进度、可取消
- 同名冲突策略(覆盖 / 跳过 / 保留两者),目录递归传输
- 新建 / 重命名 / 删除、可视化 chmod;虚拟滚动,万级条目目录依旧流畅

### AI 运维助手

- 停靠右侧栏工作,不抢占你的工作区
- 用自然语言跨所有已配置主机取证与操作(离线主机也行,它会自己建连接)
- 只读 / 自动两档执行模式;每个写操作都挂起等待逐台人工批准(单次 / 始终 / 拒绝),批准前展示完整命令
- 流式输出且过程全程可见:思考原文、一次工具调用一条时间线步骤、逐台进度;另有独立的操作记录页,事后可完整回溯
- 对话持久化:支持置顶、重命名、自动命名、续用历史;可将某个已激活的终端会话绑定为上下文,也可以不绑定任其自主选择目标
- 模型接入 OpenAI(Responses API)、Anthropic(Messages API)或自定义端点(需验证);token 用量按你设置的预算追踪

## 下载安装

从 [GitHub Releases](https://github.com/esyion/shelx/releases) 获取最新安装包:

- **Windows** — 安装程序,支持被动式原地更新
- **macOS** — Apple Silicon 与 Intel
- **Linux** — 标准 Tauri 安装包

shelx 会自动检查更新,并直接从 GitHub Releases 完成自更新。

## 从源码构建

前置条件:[Rust](https://rustup.rs/)(stable)与 [bun](https://bun.sh)。Linux 还需 Tauri 的常规依赖(webkit2gtk 等,见 [Tauri 前置条件指南](https://tauri.app/start/prerequisites/))。

```bash
bun install        # 安装前端依赖
bun tauri dev      # 开发模式,热更新
bun tauri build    # 构建当前平台安装包
```

提交前的质量门禁:

```bash
bun run build
bun run check:ipc
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## 架构

Tauri 2 桌面应用,前后端职责严格分离:

- **Rust 核心** — 通过 [russh](https://github.com/Eugeny/russh) 实现 SSH/SFTP、监控采集、传输引擎与 AI Agent 循环([rig](https://github.com/0xPlaygrounds/rig));分层为 commands → application → domain → infrastructure
- **前端** — Next.js(静态导出)+ React 19 + TypeScript + Tailwind CSS + shadcn/ui(Base UI),xterm.js 终端、Recharts 图表、Zustand 状态
- 一条 SSH 连接(一次认证)复用全部终端、SFTP、监控通道
- IPC 契约只在 Rust 侧定义一次,导出 JSON Schema 后生成前端 TypeScript 类型(`bun run gen:ipc`),前端禁止手写镜像类型。详见 [docs/IPC_CONTRACT.md](docs/IPC_CONTRACT.md)

## 安全与隐私

- 凭据只存系统钥匙串(或加密降级存储),绝不落明文文件、不进日志、不出现在 IPC 响应里
- 主机密钥 TOFU 校验,指纹变化无法被静默接受
- 无遥测、无云端、无账号、无广告
- AI 助手的远端命令一律是 argv 数组 + 允许清单;写操作需逐台显式批准,只读模式下碰都不碰

## 文档

- [docs/PRD.md](docs/PRD.md) — 产品需求文档
- [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md) — 技术实施文档
- [docs/AGENT_DESIGN.md](docs/AGENT_DESIGN.md) — AI Agent 技术方案
- [docs/IPC_CONTRACT.md](docs/IPC_CONTRACT.md) — IPC 契约规范
- [docs/UI_LAYOUT.md](docs/UI_LAYOUT.md) — 界面布局约定

## 参与贡献

欢迎提 Issue 和 Pull Request。提交前请先阅读 [AGENTS.md](AGENTS.md),其中定义了所有变更必须遵守的分层、安全与质量规则。

## 许可证

[MIT](LICENSE) © 2026 esyion
