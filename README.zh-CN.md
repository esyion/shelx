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

SSH、文件、监控。就这三件事。

做这个东西，是因为市面上的终端工具越做越满。隧道、插件市场、远程桌面、抓包、各种会话日志……对有的人有用。我自己每天真正点开的，大概就是 80% 用户都会用到的那一块：连上去敲命令、传几个文件、看一眼 CPU 和磁盘。一个窗口够了。

界面布局借鉴了 [FinalShell](https://www.finalshell.net.cn/)：左边连接树，顶上标签，同一个工作区里切终端 / 文件 / 监控。这个结构我用了很久，到现在还是最顺手的。致谢 FinalShell。

```
┌──────────────┬─────────────────────────────────┐
│ 连接树       │  标签栏                           │
│              ├──────────────────────────────────┤
│              │  终端  ·  文件  ·  监控           │
│              ├──────────────────────────────────┤
│  CPU / 内存  │  传输中心                         │
└──────────────┴─────────────────────────────────┘
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

双击左边的主机就能连。密码、OpenSSH 私钥、键盘交互（OTP）、ssh-agent。私钥路径留空会依次试 `~/.ssh/id_ed25519`、`id_ecdsa`、`id_rsa`。Windows 上 agent 先找 `openssh-ssh-agent`，再找 Pageant。

第一次连会弹出 SHA-256 主机指纹，确认后记下（TOFU）。指纹以后变了会直接拒绝，不会默默覆盖。默认 30 秒 keepalive，连续 3 次没响应才断。

终端是 xterm.js（GPU 正常时走 WebGL）。默认选中即复制、右键粘贴。`Ctrl` + 滚轮改字号。每个连接可以选 UTF-8 或 GBK，照顾国内老机器。断线时缓冲还在，能看能复制，横幅上有重连按钮。

一条 SSH 会话扛终端、文件、监控三块。从终端切到文件，pty 不会拆掉。

## 文件

双栏：左本地、右远端。列表、建目录、重命名（`F2`）、删除（`Del`）、显示隐藏文件、按名称或大小排序。文件拖进窗口，进当前远端目录。右键上传 / 下载。

进度在底部传输中心（`Ctrl+J`）：速度、剩余时间、取消、重试。同名会问你——覆盖、跳过、还是两个都留。默认并发 2。网络失败会退避重试两次；取消会留下 `.shelx-partial` 分片。

## 监控

只支持 Linux 服务器。走同一条 SSH 读 `/proc`，不装 agent，也不走 SNMP。

CPU（总占用 + 每核）、内存、Swap、网速、磁盘、负载、运行时间。磁盘超过 85% 变橙，95% 变红。侧栏底下有一条紧凑的条，工作区里是图。采样间隔 2 / 5 / 10 / 30 / 60 秒。不是 Linux 会明说不支持，不会编数字。

连上之后还会采一次主机名、内核、发行版、CPU 型号、内存，给系统信息弹窗用。

## 连接

左边那棵树就是地址簿。分组、搜索、拖着用。右键连接、编辑、克隆、删除。克隆只拷主机配置，不拷凭据。

密码不进 SQLite。进系统钥匙串（Keychain / Credential Manager / Secret Service）。钥匙串不可用时，退到 `~/.shelx` 下一份 AES-GCM 加密文件。也可以只在本次会话里记住，或者干脆不存。

没有跳板机，没有端口转发，没有插件。是故意的。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Ctrl+,` | 设置 |
| `Ctrl+B` | 侧栏 |
| `Ctrl+J` | 传输中心 |
| `Ctrl+W` | 关标签 |
| `Ctrl+Tab` | 下一个标签 |
| `Alt+1` / `2` / `3` | 终端 / 监控 / 文件 |
| `Ctrl` + 滚轮 | 终端字号 |

设置改了立刻保存：主题、字体、回滚缓冲、keepalive、传输并发、冲突策略、采样间隔。窗口布局（侧栏比例、底栏高度）也会记住。

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

技术栈：Tauri 2、russh、russh-sftp、SQLite。前端是 Next.js 静态导出 + xterm.js + React。

## 致谢

布局直接学的 **FinalShell**。用过的人，十秒内就知道东西在哪。

Bug 和想法走 [Issues](https://github.com/esyion/shelx/issues)。怎么改代码见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题走 [SECURITY.md](.github/SECURITY.md)，不要公开提。

## 许可证

[MIT](LICENSE)。© 2026 [esyion](https://github.com/esyion)
