# shelx

轻量、纯净、开源的 SSH + SFTP + 服务端监控一体化桌面管理工具(Windows / macOS / Linux)。

## 技术栈

- 桌面框架:[Tauri 2](https://v2.tauri.app/)(Rust)
- 前端:Next.js 16 App Router(**纯静态导出**)+ React 19 + TypeScript
- UI:Tailwind CSS v4 + shadcn/ui
- 状态:Zustand
- 包管理:前端 `bun`,Rust 端 `cargo`

## 架构约束

- 前端以 `output: 'export'` 静态导出,由 Tauri WebView 直接加载;禁用 SSR、
  Server Actions、动态 Route Handler 等 Node 服务端能力,所有数据经
  Tauri command / ipc Channel 获取(详见 `docs/PRD.md` §7.7)。
- 前端调用 Rust 统一走 `src/gateway`(invoke 封装),组件内禁止散落 invoke。
- 工程分层与安全规范见 `AGENTS.md`。

## 开发

```bash
bun install          # 安装前端依赖
bun tauri dev        # 启动 Tauri 开发窗口(内部运行 next dev,端口 3000)
```

## 构建与质量门禁

```bash
bun run build                                        # Next.js 静态导出 → out/
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
bun tauri build                                      # 打包桌面安装包
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
