
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

本文件是本 Tauri 项目的统一工程规范，适用于仓库根目录及其所有子目录。所有新增和修改代码都必须遵守本规范。子目录可以通过更近层级的 AGENTS.md 补充规则，但不得降低本文件中的安全、分层和质量要求。

现有代码与本规范冲突时，新增代码必须遵循本规范；对存量代码采用渐进式迁移，优先处理安全问题、跨边界契约和高风险基础设施耦合。

工具链：前端用 `bun`（包管理与构建），Rust 用 `cargo`。

## 1. 技术栈与边界

- 桌面框架 Tauri 2；前端 Next.js App Router + React + TypeScript + Tailwind CSS + shadcn/ui（Base UI 原语）+ Zustand；Rust 2021 edition。
- 前端与 Rust 的唯一跨边界通信方式是 Tauri IPC（invoke、事件、插件 API）。除 `src/gateway/tauri.ts` 外，前端任何位置禁止直接调用 `@tauri-apps/api` 的 invoke；组件统一经过所在路由目录的 `api.ts`，`api.ts` 和 `services/` 只依赖 `gateway/`。
- Tauri 前端必须保持可静态导出：禁止依赖 SSR、Server Actions、Route Handlers 或服务端运行时；不在 WebView 使用未经评估的 Node 或 Electron API；网络、文件、系统能力优先调用 Rust 端适配器。

## 2. 不可协商的硬约束

- **日志**：所有错误、异常和关键事件必须记录日志，日志中不得包含敏感信息。Rust 端用 `tracing`，前端用 `pino`。
- **注释**：所有方法必须有 docstring（Rust 用 rustdoc，TS 用 JSDoc）。
- **单文件代码行数**：非必要不超过 **500** 行。
- **ID 一律 `string`**：所有跨前后端、IPC、缓存和本地持久化的 ID 字段必须使用 `string`；禁止将雪花 ID、数据库主键或会话标识定义、传输或落盘为 `number` / `bigint`，禁止用 `parseInt` / `Number` 进行类型收窄。
- **契约单点定义**：跨边界契约只能由 Rust 定义，前端禁止手写镜像类型，详见 §5。
- **界面不得加重用户心智负担**：不得放置“用户不好操作”“不易理解”的 UI 和功能；系统必须替用户把内部模型翻译成他能直接选择的选项，而不是让用户理解系统内部机制。红线见 §4.1.1。
- **小步提交**：一次变更只解决一个主题，避免顺手重构、无关格式化和生成物入库。

## 3. 目录结构

前端必须使用 **Next.js App Router 的原生文件路由机制**：页面路由由 `src/app/` 的目录结构决定，使用 `page.tsx`、`layout.tsx`、`loading.tsx`、`error.tsx` 以及 `[id]`、`[...slug]`、`(group)` 等原生约定，页面 URL 必须能直接从目录结构读出。

- **禁止**用 `features/`、路由注册表、React Router、手动 pathname 判断或其他自定义路由抽象替代文件路由。
- **禁止**把 Next.js 当“套壳”使用：不得通过单一 `page.tsx` + 自定义组件/状态模拟多页面路由。
- 页面禁止内联 CSS，必须使用 Tailwind CSS 语义令牌和 shadcn/ui 组件。

结构随功能演进，空目录不必预先创建：

    src/
      app/                      # 路由、布局、全局样式
        <feature>/              # 业务页面：hooks/、api.ts（调 gateway）、types.ts、index.ts
      components/               # 跨路由复用的纯 UI 组件
        ui/                     # shadcn 组件，只由 CLI 安装维护，禁止手改
      services/                 # storage、通知等前端服务，只依赖 gateway
      stores/                   # 客户端状态
      gateway/                  # tauri.ts：全项目唯一的 invoke/Channel 出口
      types/                    # 各模块再导出；gen/ 为 gen:ipc 生成物，禁止手改
      lib/                      # cn()、纯函数、格式化、语义色映射（如 agent-events.ts）
    src-tauri/
      src/
        main.rs                 # 进程入口，只负责启动 lib::run
        lib.rs                  # Builder、插件注册、command 注册
        commands/               # 接口层：Tauri command 薄适配器
        application/            # 应用层：用例、事务编排、端口 trait
        domain/                 # 领域层：实体、值对象、业务规则、领域错误
        infrastructure/         # 文件、数据库、网络、OS、插件适配器
        dto/                    # IPC 请求、响应和错误 DTO
        shared/                 # 日志、配置、错误转换、通用类型
        state.rs                # 应用状态组装与依赖注入
        ipc_contract.rs         # 导出跨边界 JSON Schema（见 §5）
      capabilities/             # Tauri 权限声明
      contract/                 # 生成的 ipc-schema.json
      migrations/               # 数据迁移
    tests/                      # 跨层和端到端测试
    docs/                       # 架构、IPC_CONTRACT、发布文档

## 4. 分层职责与依赖规则

依赖单向流动：表示层 → 应用层 → 领域层；基础设施层为领域层和应用层提供实现，但业务层不得依赖 UI 或 Tauri 运行时细节。核心业务通过 trait 依赖抽象，I/O、文件系统、网络、系统 API 和 Tauri 运行时放在基础设施适配器中，保证可测试、可替换。

### 4.1 前端表示层

- 页面、组件和 hooks 只处理渲染、用户交互、加载态、空态和错误展示；副作用集中到 hooks 和 services，渲染函数保持纯净。
- 业务能力按 `src/app/<feature>/` 路由目录组织，页面、hooks、api.ts、types.ts 与路由内聚；跨路由复用的 UI 组件下沉到 `components/`，可复用服务下沉到 `services/`，纯函数下沉到 `lib/`。禁止把所有逻辑集中在单个 page.tsx。
- 不在前端复制 Rust 端的核心业务规则；前端校验只用于提升交互体验，服务端校验才是最终约束。

### 4.1.1 界面可用性红线（产品硬约束，评审与自测必须逐条过）

做任何界面时先问：“一个不懂内部机制的用户，能不能只靠这一屏独立完成操作”。以下情况一律视为缺陷，不允许以“高级功能”或“文案问题”为由保留：

- **内部术语与内部值不得进界面正文**：枚举原值（如 `transferring`、`awaiting_conflict`）、里程碑编号（M2/M4）、算法名、裸 ID / 指纹 / 八进制位、协议术语只能出现在次要说明里，主文案必须是“选了会发生什么”的人话；英文枚举要做中文映射并集中在一处常量。
- **手写结构化输入要换成选择器**：手写 cron、JSON、ISO 时间、IANA 时区、字节/毫秒/秒的路径或数值，一律改为选项、档位下拉、构造器或带单位的控件，并实时回显人类可读结果。数值区间必须与后端校验对齐，从源头禁止非法值。
- **“即时保存”不得吃掉用户输入**：草稿态提交（失焦/Enter）而非逐字符保存；提交前做前端同区间校验；提交失败必须展示后端错误原文、保留用户输入并回滚显示值，禁止用固定文案吞错。
- **必填与前置条件要事前拦**：字段级行内错误 + 聚焦第一个错误控件；前置条件不满足时禁用按钮并说明原因；已知不支持的平台/环境要在入口就说明，不等报错。
- **不允许死状态**：任何等待用户的状态（冲突待决策、待授权、待确认）必须持续可见并提供重新进入路径；异常态给出下一步，不只是“失败”。
- **后端有能力就必须有界面入口**：已实现并校验的配置项、已注册的 command、已写好的弹窗组件，必须有可达入口；确实不提供的能力不要把开关或禁用控件摆在那里充数。
- **破坏性操作说清连带后果**：是否可恢复、是否递归、凭据与关联数据会怎样，必须与后端真实行为一致，禁止承诺不存在的功能。
- **助手类面板不得抢占工作区**：AI 助手、检视面板一类的常驻辅助功能用停靠侧栏（挤压工作区、不遮挡内容，如 Resizable 右栏）或覆盖层（弹窗）挂在常驻外壳，由 store 开关驱动，禁止新开整页路由把用户从正在查看的终端或文件列表上拽走；面板收起不得中断后台运行，其等待状态要留在入口上。
- **主动帮用户做**：空态给下一步路径；提供试跑/自检（如测试连接）；列表默认展示用户关心的维度（如修改时间）且可排序；无信息时留空而不是伪造值。

控件与原语（只能有一种原语：Base UI）：

- `components.json` 的 `style` 为 `base-nova`。**禁止**新增 Radix 依赖或 Radix 版组件；组件只从 `ui.shadcn.com` 的 base 注册表安装（`bunx --bun shadcn@latest add <name>`），AI Elements 走 shadcn 的 `ai-elements/base/*` pattern，**禁止**从 `elements.ai-sdk.dev` 安装（那是 Radix + `ai` 类型那份）。Customization 由 CLI 落地，`src/components/ui/` 禁止手改。
- 控件只能用 shadcn/ui 现有件：输入 `Input` / `InputGroup` / `Textarea`，列表行 `Item`，错误与提示 `Alert`，开关行 `Field`，空态 `Empty`，选择 `NativeSelect` / `Select`，选项 2–7 个用 `ToggleGroup`，模型/会话类选择器用 `DropdownMenu` + `DropdownMenuRadioGroup`。不得在业务组件里手写 `<textarea>`、自造滚动容器或 `scrollIntoView`。
- AI 对话面按 shadcn chat / AI Elements pattern 组：线程用 `MessageScroller`（`scrollAnchor` 标用户轮次，`MessageScrollerButton` 回底），人的回合用 `Bubble`，Agent 答案直接放 `MessageContent`（不套气泡）；推理、工具调用、逐台进度一律是 `Trace` / `TraceLine`（`status` 只允许 `running|error|pending`，由我们把后端枚举映射成中文时态措辞，禁止透传内部枚举），有结果才升 `TraceCollapsible`；这一轮的过程只有**一条有序时间线**：流式状态是 `AgentStreamFragment.parts`（思考段 / 工具步 / 回答段，形状照 ai-sdk 的 `UIMessage.parts`），渲染时把连续同类合成一段（`chainSegments`），所以“想→做→又想”是三块，而不是把第二次思考接到第一段的文本尾巴上——**禁止**按类别分桶存（一分桶先后就毁了）。思考原文走 `Reasoning`（`src/components/agent/reasoning.tsx`，整段折叠，想的时候展开、说完自动收起，**禁止**把模型独白拆成一行行伪装成步骤），执行步骤走思维链 Chain of Thought（`src/components/agent/chain-of-thought.tsx` + `src/lib/agent-chain.ts`，**一步 = 一次工具调用**，身份是后端 `tool_host` 生成的 `callId`：开步、逐台进度、收尾三条事件共用它，**禁止**按工具名归并（并行同名调用会串成一步），一次调用扇出的多台主机合成一步、多台只报计数不刷行），摘要行进行中说“现在在做什么”、结束后报步数与未完成的步数，有入参才再升一层 `TraceCollapsible` 并用 `CodeBlock` 显示入参，运行中自动展开、结束自动收起并带 `keepMounted`；没有逐台进度的工具（列连接、记记忆）必须由 `tool_result` 收尾事件结束，不许留“准备执行”的死状态；思考原文块受 `agent.showReasoning` 控制；命令、入参、输出、日志一律用 `CodeBlock`，禁止手写 `<pre>`；待批准是提示不是轨迹行，渲染在 `Trace` 之外，每台一个 `Item` + `ItemActions`（三档决定用 `ToggleGroup`）；输入区用 `InputGroup` + `InputGroupTextarea` + `InputGroupAddon`；用量用 `HoverCard` + `Progress`，分母取后端解析的模型窗口而不是前端假设的模型上限。
- 色值必须走语义令牌或集中映射表（如 `src/lib/agent-events.ts` 的 `TONE_CLASS` / `TONE_BADGE`），禁止散落 `bg-amber-500` 一类的硬编码。

改动界面后需自检：文案无内部术语、无假开关、无死状态、失败不丢输入、破坏性提示准确、能力有入口、控件来自 shadcn 且色值走语义令牌。

### 4.2 Tauri command 接口层

每个 command 必须遵循固定顺序：接收 DTO → 边界校验与权限检查 → 从 State 获取应用服务 → 调用一个明确的应用用例 → 将领域结果映射为响应 DTO → 将错误转换为稳定的 IPC 错误结构。

- command 命名使用动作加资源，例如 `list_projects`、`create_project`。
- 不在 command 中直接访问文件系统、数据库、网络或调用操作系统命令。
- 不返回 any、调试字符串或 Rust 内部错误堆栈。
- 新增 command 必须同步更新 invoke_handler、前端 gateway、DTO 和 capability。
- 禁止把所有逻辑堆进 `src-tauri/src/lib.rs`；UI 组件不得直接访问 Rust 内部模块或基础设施实现。

### 4.3 应用层、领域层、基础设施层

- **应用层**：表达用户可执行的用例（创建、导入、同步、导出、删除），负责流程编排、事务边界、幂等性、重试策略和跨领域协调；通过 trait 定义端口（如 ProjectRepository、FileSystem、Clock），实现放 infrastructure；不依赖 React、Tauri command、窗口对象或具体数据库驱动。
- **领域层**：放置实体、值对象、聚合、领域服务、领域事件和领域错误；领域对象负责保持自身不变量，构造函数和变更方法必须拒绝非法状态；保持纯 Rust，可脱离 Tauri 运行和测试；禁止读取环境变量、访问文件、发 HTTP 请求或直接序列化 IPC DTO。
- **基础设施层**：封装数据库、文件系统、HTTP、剪贴板、通知、进程、窗口和 Tauri 插件等外部依赖；处理超时、资源释放、平台差异、路径规范化和第三方错误映射；不向上层泄露驱动类型，通过应用层端口返回业务可理解的结果；OS 能力必须有明确 allowlist，禁止把任意路径和任意参数直接交给外部进程或 shell。

## 5. IPC 契约规范

响应结构：

    type IpcResult<T> =
      | { ok: true; data: T }
      | { ok: false; error: { code: string; message: string; details?: unknown } };

- 请求和响应字段使用 camelCase；Rust 内部字段可使用 snake_case，但通过 serde 显式映射。
- DTO 只包含跨边界所需字段，避免传输大对象、敏感信息和不可控的动态结构。
- **跨边界契约只能有一处定义（后端）**：字段名、取值类型、可空性、枚举字面量、数值区间与单位一律由 Rust 侧提供，前端禁止手写镜像类型或复制一份区间/档位常量。机制与流程见 `docs/IPC_CONTRACT.md`：类型由 `src-tauri/src/ipc_contract.rs` 导出 JSON Schema，`bun run gen:ipc` 生成 `src/types/gen/**`（生成物禁止手改，`bun run check:ipc` 与 vitest 校验未过期），`src/types/<module>.ts` 只做再导出与别名。新增设置项只需在 `application/settings/schema.rs` 登记区间与档位（校验与界面档位同源），前端补文案即可露出。
- 写接口的补丁校验必须**拒绝契约外字段**，禁止“未知字段静默忽略”：字段名漂移会读为 undefined、写被丢弃，设置项在用户看来能改实际永远无效。越界与未知字段应随 `error.details` 回传结构化信息（路径/区间/单位），供前端把错误定位到具体控件。
- 错误码稳定、可枚举、可用于前端分支判断；用户文案与错误码解耦。
- 对分页、排序、过滤、日期、金额和路径等类型定义统一格式，不依赖隐式约定。
- 变更契约时优先向后兼容；删除字段或 command 前先迁移所有调用方，并更新 docs/。

## 6. 状态、并发与错误处理

- 全局共享状态集中组装，使用 Tauri State 注入；禁止在 command 中使用不可控的全局可变变量和未经说明的全局状态。
- 明确 Send 和 Sync 要求；锁的粒度要小，避免在持锁期间执行 I/O 或等待外部任务。
- 长任务不得阻塞 UI；使用异步 command、后台任务和进度事件，并支持取消或关闭时清理。
- Rust 使用 Result 传播错误，禁止无理由 unwrap 和 expect；启动阶段不可恢复错误必须包含上下文。
- 错误分层：领域错误 → 应用错误 → 基础设施错误 → IPC 错误；边界处统一记录日志并脱敏，禁止静默吞错和未处理的 promise rejection。
- 前端必须覆盖 loading、success、empty、error 和 retry 五类状态，避免静默失败。

## 7. 安全规范

- capability 遵循最小权限原则，按功能或窗口拆分；禁止为了方便扩大 capability、暴露通配权限或关闭 CSP。生产环境配置明确 CSP，只有经过评估的外部域名才允许访问。
- 所有来自前端、文件、网络和系统的输入都视为不可信：校验类型、长度、格式、路径和资源数量。
- 文件路径必须规范化，并限制在允许的工作目录；禁止路径穿越。
- 禁止通过 shell 拼接用户输入；如确需启动外部程序，使用固定可执行文件和参数数组，并做 allowlist。
- 密钥、令牌、用户隐私、签名材料和内部堆栈不得写入日志、IPC 响应或仓库；使用环境变量或系统安全存储。不提交 .env、签名私钥、证书、生产数据和本地构建产物。
- 新增插件、权限或外部依赖必须说明用途、风险和回滚方式。

## 8. 代码风格

### TypeScript 和 React

- 使用 TypeScript 严格模式；禁止新增 any，必要时使用 unknown 并进行类型收窄。
- 组件使用函数组件；hooks 只在组件或自定义 hook 顶层调用。
- 组件名、类型名使用 PascalCase；变量、函数和文件名使用 camelCase；常量使用 UPPER_SNAKE_CASE。
- 类型优先使用 type，需要声明合并或实现契约时使用 interface。
- 公共组件必须优先组合 shadcn/ui 组件，并具有清晰 props 类型、可访问名称、键盘操作和必要的 aria 属性；样式使用 Tailwind CSS 语义令牌，禁止在业务组件中重复实现已有 shadcn/ui 组件。

### Rust

- 遵循 rustfmt、clippy 和 Rust API Guidelines。
- 模块、函数、变量使用 snake_case；类型、trait、枚举使用 PascalCase；常量使用 SCREAMING_SNAKE_CASE。
- 优先借用和不可变数据；只有在确有必要时使用 clone。
- 公共 API、trait 和复杂业务规则必须写 rustdoc 说明约束。
- 错误类型使用 thiserror（如引入）统一建模；避免用字符串拼接替代结构化错误。

## 9. 测试与质量门禁

提交前至少执行：

    bun run build
    bun run check:ipc
    cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
    cargo test --manifest-path src-tauri/Cargo.toml

- 领域规则优先写 Rust 单元测试，覆盖正常、边界和非法输入。
- 应用层使用 fake 或 mock port 测试流程编排，不依赖真实文件系统或网络。
- command 至少覆盖 DTO 校验、错误映射和权限相关路径。
- 前端 feature 测试用户可见行为，而不是实现细节。
- 修复 bug 时必须补充能够复现该 bug 的回归测试。
- 涉及窗口、权限、打包、自动更新或平台差异时，增加对应平台的手工验证记录。

## 10. 配置、依赖与数据迁移

- 依赖按用途分组，定期清理未使用依赖；升级依赖前查看 breaking changes 和安全公告。
- Tauri 的 beforeDevCommand 和 beforeBuildCommand 必须和团队实际命令一致（bun / cargo）。
- 环境配置通过 .env.example 记录非敏感变量说明，敏感值只在本地或 CI 注入。
- 数据库 schema 变更必须提供可重复执行、可回滚或可恢复的 migration，并保留版本号。
- 用户数据目录遵循项目既定约定：本机数据存放于 `~/.shelx`，设置文件使用 Tauri 平台配置目录；禁止硬编码绝对路径或依赖系统特定路径假设。

## 11. Git、提交与变更说明

- 提交信息使用 Conventional Commits：feat、fix、refactor、test、docs、chore。
- PR 或变更说明必须包含：背景、方案、影响范围、IPC 契约变化、安全影响、测试命令和已知限制。
- 不提交 dist/、target/、临时截图、调试日志、IDE 私有配置和生成目录。
- 代码审查重点：层间依赖是否正确、权限是否最小、错误是否可观察、输入校验、资源释放、跨平台行为是否明确。

新功能实施顺序：用户用例、数据流与 IPC 契约 → domain 业务规则和错误 → application 用例与端口 → infrastructure 适配器 → commands 薄适配器并在 lib.rs 注册 → 前端 feature 的 api、状态和 UI → capability、配置、文档和迁移 → 测试与质量门禁 → 开发环境、生产构建与目标平台手工验证。
