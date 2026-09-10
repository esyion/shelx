
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

本文件是本 Tauri 项目的统一工程规范，适用于仓库根目录及其所有子目录。所有新增和修改代码都必须遵守本规范。子目录可以通过更近层级的 AGENTS.md 补充规则，但不得降低本文件中的安全、分层和质量要求。

- 本项目使用`bun`作为前端包管理器和构建工具，使用`cargo`作为 Rust 包管理器和构建工具。

## 1. 项目定位与技术栈

- 桌面应用框架：Tauri 2。
- 前端：Next.js App Router + React + TypeScript + Tailwind CSS + shadcn/ui (Base-ui)+Zstand。
- Rust 端：Rust 2021 edition。
- 前端与 Rust 的唯一跨边界通信方式：Tauri IPC，包括 invoke、事件和插件 API。

## 2. 核心原则

0. 所有的方法必须要加docstring
1. **分层依赖单向流动**：表示层 → 应用层 → 领域层；基础设施层为领域层和应用层提供实现，但业务层不得依赖 UI 或 Tauri 运行时细节。
2. **IPC 是边界，不是业务层**：Tauri command 只负责参数接收、边界校验、权限检查、调用用例和结果序列化，不在 command 中堆积业务逻辑。
3. **显式数据契约**：前后端传输使用稳定 DTO，字段命名、可空性和错误结构必须明确；禁止直接把内部实体、数据库模型或第三方库类型暴露给前端。
4. **安全默认开启**：最小权限、最小暴露面，禁止任意命令执行和任意文件访问；新增能力必须评估 capability、CSP、路径和输入校验。
5. **可测试、可替换**：核心业务通过 trait 或接口依赖抽象，I/O、文件系统、网络、系统 API 和 Tauri 运行时放在基础设施适配器中。
6. **小步提交**：一次变更只解决一个主题，避免顺手重构、无关格式化和生成物入库。

## 3. 推荐目录结构

前端必须使用 **Next.js App Router 的原生文件路由机制**进行开发。

要求：

- 所有页面路由必须基于 `src/app/` 目录的文件/目录结构生成。
- 必须使用 `page.tsx`、`layout.tsx`、`loading.tsx`、`error.tsx` 等 Next.js 原生路由约定。
- 使用动态路由 `[id]`、Catch-all `[...slug]`、Route Group `(group)` 等 Next.js 原生能力。
- **禁止使用 `features/`、路由注册表、React Router、手动 pathname 判断或其他自定义路由抽象来替代文件路由。**
- **禁止把 Next.js 当作“套壳”使用**，不得通过单一 `page.tsx` + 自定义组件/状态来模拟多页面路由。
- 页面 URL 必须能够从 `src/app/` 的目录结构中直接对应和理解。

优先遵循 Next.js 官方 App Router 设计，不要自行发明路由体系。

随着功能增加，按以下结构演进；空目录不必预先创建。

    .
    ├─ src/                                  # 前端表示层
    │  ├─ app/                               # Next.js App Router、布局、页面、全局样式
    │  │  ├─ layout.tsx                      # 页面布局
    │  │  ├─ page.tsx                        # 主页面入口
    │  │  └─ xxx/                            # 业务页面
    │  │     ├─ hooks/                       # UI 和交互 hooks
    │  │     ├─ api.ts                       # 调用前端 gateway，不直接散落 invoke
    │  │     ├─ types.ts                     # 展示模型和请求模型
    │  │     └─ index.ts                     # 对外公开入口
    │  ├─ components/                        # 跨业务复用的纯 UI 组件
    │  ├─ services/                          # 前端服务层：storage、通知等，只依赖 gateway 访问 Rust
    │  ├─ stores/                            # 客户端状态
    │  ├─ gateway/                           # Tauri IPC 统一封装层
    │  │  ├─ tauri.ts                        # 全项目唯一的 invoke/Channel 出口
    │  │  └─ index.ts                        # 对外公开入口
    │  ├─ types/                             # 类型定义目录
    │  │  ├─ xxx.ts
    │  │  └─ index.ts                        # 对外公开入口
    │  └─ lib/                               # shadcn cn()、纯函数、格式化和常量
    ├─ src-tauri/
    │  ├─ src/
    │  │  ├─ main.rs                         # 进程入口，只负责启动 lib::run
    │  │  ├─ lib.rs                          # Builder、插件注册、command 注册
    │  │  ├─ commands/                       # 接口层：Tauri command 薄适配器
    │  │  ├─ application/                    # 应用层：用例、事务编排、端口
    │  │  ├─ domain/                         # 领域层：实体、值对象、业务规则
    │  │  ├─ infrastructure/                 # 文件、数据库、网络、OS、插件适配器
    │  │  ├─ dto/                            # IPC 请求、响应和错误 DTO
    │  │  ├─ shared/                         # 日志、配置、错误转换、通用类型
    │  │  └─ state.rs                        # 应用状态组装与依赖注入
    │  ├─ capabilities/                      # Tauri 权限声明
    │  ├─ migrations/                        # 数据迁移
    │  ├─ icons/                             # 应用图标
    │  ├─ tauri.conf.json                    # Tauri 构建和窗口配置
    │  └─ Cargo.toml                         # Rust 依赖与包配置
    ├─ tests/                                # 跨层和端到端测试
    └─ docs/                                 # 架构、IPC 契约、发布文档

## 4. 分层职责与依赖规则

### 4.1 前端表示层

- 单文件代码行数非必要不要超过`300`行
- Next.js 页面、组件和 hooks 只处理渲染、用户交互、加载态、空态和错误展示。Tauri 前端必须保持可静态导出，禁止依赖 SSR、Server Actions、Route Handlers 或服务端运行时。
- 业务能力按 `src/app/<feature>/` 路由目录组织，页面、hooks、api.ts、types.ts 与路由内聚；跨路由复用的 UI 组件下沉到 `components/`，可复用前端服务下沉到 `services/`，纯函数下沉到 `lib/`。禁止把所有逻辑集中在单个 page.tsx。
- 前端调用 Rust 时，组件统一经过所在路由目录的 `api.ts`；`api.ts` 和 `services/` 只能依赖 `gateway/` 的统一封装。除 `gateway/tauri.ts` 外，前端任何位置禁止直接调用 `@tauri-apps/api` 的 invoke。
- 不在前端复制 Rust 端的核心业务规则；前端校验只用于提升交互体验，服务端校验才是最终约束。
- 网络、文件、系统能力优先调用 Rust 端适配器，不在 WebView 中使用未经评估的 Node 或 Electron API。

### 4.2 Tauri command 接口层

每个 command 必须遵循以下顺序：

1. 接收 DTO 参数。
2. 做边界校验、权限检查和必要的上下文提取。
3. 从 State 获取应用服务。
4. 调用一个明确的应用用例。
5. 将领域结果映射为响应 DTO。
6. 将错误转换为稳定的 IPC 错误结构。

约束：

- 单文件代码行数非必要不要超过`300`行
- command 命名使用动作加资源，例如 list_projects、create_project。
- 不在 command 中直接访问文件系统、数据库、网络或调用操作系统命令。
- 不返回 any、调试字符串或 Rust 内部错误堆栈。
- 新增 command 必须同步更新 invoke_handler、前端 gateway、DTO 和 capability。

### 4.3 应用层

- 表达用户可执行的用例，如创建、导入、同步、导出和删除。
- 负责流程编排、事务边界、幂等性、重试策略和跨领域协调。
- 通过 trait 定义端口，例如 ProjectRepository、FileSystem 和 Clock；具体实现放在 infrastructure。
- 不依赖 React、Tauri command、窗口对象或具体数据库驱动。

### 4.4 领域层

- 放置实体、值对象、聚合、领域服务、领域事件和领域错误。
- 领域对象负责保持自身不变量；构造函数和变更方法必须拒绝非法状态。
- 领域层应保持纯 Rust，可脱离 Tauri 运行和测试。
- 禁止在领域层读取环境变量、访问文件、发 HTTP 请求或直接序列化 IPC DTO。

### 4.5 基础设施层

- 封装数据库、文件系统、HTTP、剪贴板、通知、进程、窗口和 Tauri 插件等外部依赖。
- 处理超时、资源释放、平台差异、路径规范化和第三方错误映射。
- 不向上层泄露驱动类型；通过应用层端口返回业务可理解的结果。
- OS 能力必须有明确 allowlist；禁止把任意路径和任意参数直接交给外部进程或 shell。

## 5. IPC 契约规范

推荐响应结构：

    type IpcResult<T> =
      | { ok: true; data: T }
      | { ok: false; error: { code: string; message: string; details?: unknown } };

- 请求和响应字段使用 camelCase；Rust 内部字段可使用 snake_case，但通过 serde 显式映射。
- DTO 只包含跨边界所需字段，避免传输大对象、敏感信息和不可控的动态结构。
- 所有跨前后端、IPC、缓存和本地持久化的 ID 字段必须统一使用 `string`；禁止将雪花 ID、数据库主键或会话标识定义、传输或落盘为 `number` / `bigint`，也禁止用 `parseInt` / `Number` 进行类型收窄。
- 错误码稳定、可枚举、可用于前端分支判断；用户文案与错误码解耦。
- 对分页、排序、过滤、日期、金额和路径等类型定义统一格式，不依赖隐式约定。
- 变更契约时优先向后兼容；删除字段或 command 前先迁移所有调用方，并更新 docs/。

## 6. 状态、并发与错误处理

- 全局共享状态集中组装，使用 Tauri State 注入；禁止在 command 中使用不可控的全局可变变量。
- 明确 Send 和 Sync 要求；锁的粒度要小，避免在持锁期间执行 I/O 或等待外部任务。
- 长任务不得阻塞 UI；使用异步 command、后台任务和进度事件，并支持取消或关闭时清理。
- Rust 使用 Result 传播错误，禁止无理由 unwrap 和 expect；启动阶段不可恢复错误必须包含上下文。
- 错误分层：领域错误 → 应用错误 → 基础设施错误 → IPC 错误；边界处统一记录日志并脱敏。
- 前端必须覆盖 loading、success、empty、error 和 retry 五类状态，避免静默失败。

## 7. 安全规范

- capability 遵循最小权限原则，按功能或窗口拆分，不使用过宽的通配权限。
- 生产环境配置明确 CSP；只有经过评估的外部域名才允许访问。
- 所有来自前端、文件、网络和系统的输入都视为不可信：校验类型、长度、格式、路径和资源数量。
- 文件路径必须规范化，并限制在允许的工作目录；禁止路径穿越。
- 禁止通过 shell 拼接用户输入；如确需启动外部程序，使用固定可执行文件和参数数组，并做 allowlist。
- 密钥、令牌、用户隐私和内部堆栈不得写入日志、IPC 响应或仓库；使用环境变量或系统安全存储。
- 不提交 .env、签名私钥、证书、生产数据和本地构建产物。
- 新增插件、权限或外部依赖必须说明用途、风险和回滚方式。

## 8. 代码风格

### TypeScript 和 React

- 使用 TypeScript 严格模式；禁止新增 any，必要时使用 unknown 并进行类型收窄。
- 组件使用函数组件；hooks 只在组件或自定义 hook 顶层调用。
- 组件名、类型名使用 PascalCase；变量、函数和文件名使用 camelCase；常量使用 UPPER_SNAKE_CASE。
- 类型优先使用 type，需要声明合并或实现契约时使用 interface。
- 副作用集中到 hooks 和 services；渲染函数保持纯净。
- 公共组件必须优先组合 shadcn/ui 组件，并具有清晰 props 类型、可访问名称、键盘操作和必要的 aria 属性。样式使用 Tailwind CSS 语义令牌，禁止在业务组件中重复实现已有 shadcn/ui 组件。

### Rust

- 遵循 rustfmt、clippy 和 Rust API Guidelines。
- 模块、函数、变量使用 snake_case；类型、trait、枚举使用 PascalCase；常量使用 SCREAMING_SNAKE_CASE。
- 优先借用和不可变数据；只有在确有必要时使用 clone。
- 公共 API、trait 和复杂业务规则必须写 rustdoc 或注释说明约束。
- 错误类型使用 thiserror（如引入）统一建模；避免用字符串拼接替代结构化错误。

## 9. 测试与质量门禁

提交前至少执行：

    bun run build
    cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
    cargo test --manifest-path src-tauri/Cargo.toml

测试要求：

- 领域规则优先写 Rust 单元测试，覆盖正常、边界和非法输入。
- 应用层使用 fake 或 mock port 测试流程编排，不依赖真实文件系统或网络。
- command 至少覆盖 DTO 校验、错误映射和权限相关路径。
- 前端 feature 测试用户可见行为，而不是实现细节。
- 修复 bug 时必须补充能够复现该 bug 的回归测试。
- 涉及窗口、权限、打包、自动更新或平台差异时，增加对应平台的手工验证记录。

## 10. 配置、依赖与数据迁移

- 依赖按用途分组，定期清理未使用依赖；升级依赖前查看 breaking changes 和安全公告。
- 前端依赖使用项目既定包管理器；Tauri 的 beforeDevCommand 和 beforeBuildCommand 必须和团队实际命令一致。
- 环境配置通过 .env.example 记录非敏感变量说明，敏感值只在本地或 CI 注入。
- 数据库 schema 变更必须提供可重复执行、可回滚或可恢复的 migration，并保留版本号。
- 用户数据目录遵循项目既定约定：本机数据存放于 `~/.agents-plus`（主目录约定，与 cc-switch 生态对齐），设置文件使用 Tauri 平台配置目录；禁止硬编码绝对路径或依赖系统特定路径假设。

## 11. Git、提交与变更说明

- 提交信息建议使用 Conventional Commits：feat、fix、refactor、test、docs、chore。
- PR 或变更说明必须包含：背景、方案、影响范围、IPC 契约变化、安全影响、测试命令和已知限制。
- 不提交 dist/、target/、临时截图、调试日志和 IDE 私有配置。
- 代码审查重点：层间依赖是否正确、权限是否最小、错误是否可观察、输入是否校验、资源是否释放、跨平台行为是否明确。

## 12. 新功能实施流程

1. 先写清用户用例、数据流和 IPC 契约。
2. 在 domain/ 定义业务规则和错误。
3. 在 application/ 定义用例及所需 port。
4. 在 infrastructure/ 实现外部依赖适配器。
5. 在 commands/ 增加薄 command，并在 lib.rs 注册。
6. 在前端 feature 中实现 api gateway、状态管理和 UI。
7. 更新 capability、配置、文档和迁移。
8. 编写测试并执行质量门禁。
9. 进行开发环境、生产构建和目标平台手工验证。

## 13. 禁止事项

- 禁止把所有逻辑写在 src-tauri/src/lib.rs 或前端 App.tsx。
- 禁止 UI 组件直接访问 Rust 内部模块或基础设施实现。
- 禁止 command 直接操作数据库或文件系统并返回内部错误。
- 禁止为了方便扩大 capability、关闭 CSP 或暴露通配权限。
- 禁止提交密钥、签名材料、用户数据和生成目录。
- 禁止使用无上下文的 unwrap、静默吞错、未处理的 promise rejection 和未经说明的全局状态。

当现有代码与本规范冲突时，新增代码必须遵循本规范；对存量代码采用渐进式迁移，优先处理安全问题、跨边界契约和高风险基础设施耦合。
