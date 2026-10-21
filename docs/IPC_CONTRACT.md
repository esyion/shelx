# IPC 契约与类型生成规范

本文是 shelx 跨边界数据契约的**唯一规范**。目的：让"前端类型 = 后端实现"成为机器事实，
而不是靠人记住要去同步两份代码。历史上 `chunkSizeKiB` / `chunkSizeKib` 的漂移事故
（见 §7）就是没有本规范时的典型后果：设置项在界面上能改，实际永远不生效。

相关条款：AGENTS.md §5（数据契约）、§4.1.1（界面可用性红线）、§9（质量门禁）。

---

## 1. 四条不变量

1. **单点定义**：任何跨 IPC 边界的字段名、类型、可空性、枚举取值、数值区间与单位，
   只在 Rust 侧定义一次。前端不存在"第二个定义处"。
2. **生成物不可手改**：`src/types/gen/**` 全部由 `bun run gen:ipc` 产出。
   需要更友好的类型名，只允许在 `src/types/<module>.ts` 里做再导出/别名。
3. **漂移必被门禁拦住**：`cargo test --lib`、`bun run check:ipc`、`bunx tsc --noEmit`、
   `bun run test` 四条都能独立发现"改了后端没重新生成"或"前端写了不存在的字段"。
4. **导出必须可复现**：`ipc_contract::document()` 递归按键字典序落盘。
   schemars 的 `$defs`/`properties` 来自哈希表，插入顺序随进程变化；不排序时同一份
   Rust 代码每次重新导出都会重排生成物字段，`check:ipc` 会在契约没变的情况下偶红。
   回归用例：`cargo test --lib ipc_contract::contract_document_keys_are_sorted`（M5 时发现）。

## 2. 工件与目录

| 路径 | 角色 | 谁能改 |
| ------ | ------ | -------- |
| `src-tauri/src/dto/**`、`src-tauri/src/application/settings/**`、`src-tauri/src/shared/error.rs`、`src-tauri/src/domain/{session,transfer}.rs`、`src-tauri/src/application/ports.rs` | 契约定义处（`serde` 属性决定线上名字与枚举字面量） | 人 |
| `src-tauri/src/ipc_contract.rs` | 导出与守卫用例（模块 → 类型清单） | 人（新增类型时登记） |
| `src-tauri/contract/ipc-schema.json` | JSON Schema 文档（类型形状） | 生成 |
| `src-tauri/contract/settings-contract.json` | 设置项运行时数据（路径/区间/档位/默认值） | 生成 |
| `src/types/gen/**` | TS 类型生成物 | 生成 |
| `src/types/<module>.ts` | 前端出口：再导出 + 别名 + 前端自有类型 | 人 |

## 3. 日常流程

### 3.1 新增/修改一个 DTO 字段

1. 改 Rust 类型（`dto/` 或对应应用层类型）。新类型首次进入契约时：
   - derive 追加 `schemars::JsonSchema`（序列化字面量一律由 `#[serde(...)]` 决定，
     禁止再用 `#[ts(...)]` 之类第二套命名声明）；
   - 在 `src-tauri/src/ipc_contract.rs` 的对应模块里登记该类型。
2. `bun run gen:ipc`（内部执行 `SHELX_UPDATE_CONTRACT=1 cargo test --lib ipc_contract`，
   再编译 `src/types/gen/*.ts`）。
3. 在 `src/types/<module>.ts` 补一条再导出或别名（只起名字作用，不写形状）。
4. `bunx tsc --noEmit`：所有消费点自动对齐；报出来的错就是真实漂移，按业务语义修，
   **不允许**用 `any`、`as unknown as`、`@ts-expect-error` 绕过。

### 3.2 新增一个设置项

1. 在 `application/settings/mod.rs` 加字段 + 默认值；
2. 在 `application/settings/schema.rs` 的登记表里加一条
   `path / unit / kind(区间、档位、候选值)` —— **区间与档位只写在这里**；
3. `bun run gen:ipc`（同时刷新 `settings-contract.json` 与 `gen/settingPaths.ts`）；
4. 在 `src/app/settings/settings-copy.ts` 登记中文 `label/hint`（可选 `options` 中文映射）。
   渲染规则是「契约有 + 文案有 → 渲染」：不登记文案就不露出（用于 `language`、`migration.*`
   这类当前版本不打算给界面的项），**不许**摆一个改了没用的开关。
5. 界面自动出现对应控件：`int/float` → 契约档位下拉，`enum` → 候选下拉，
   `bool` → 开关，`text` → 字体栈等前端候选或自由输入。

### 3.3 只改了校验区间

只改 `schema.rs` 的登记表即可（`AppSettings::validate` 与界面档位同源），
跑 `bun run gen:ipc` 刷新工件。**禁止**在任何地方再抄一份区间或档位常量。

## 4. 命名与类型约定

- 线上字段名：`#[serde(rename_all = "camelCase")]`；枚举字面量：由 `rename_all` 决定
  （`lowercase` / `snake_case` / `SCREAMING_SNAKE_CASE`），且必须与该枚举 `as_str()`
  一致 —— 由 `ipc_contract.rs::enum_wire_literals_are_unchanged` 断言。
- **ID 一律 `string`**：`contract` 导出用例 `every_id_field_is_string_typed` 会扫描
  所有名为 `id` / `*Id` 的属性，非 string 直接失败。禁止数字 ID 跨边界。
- 可空：`Option<T>` → TS `T | null`；设置项默认值/违规详情用 `SettingScalar`
  （字符串/数值/布尔/字符串列表）而不是 `serde_json::Value`，避免生成出
  `{ [k: string]: any }` 这种失去约束的类型。
- 时间：跨边界统一 UNIX 秒（`u64`）或毫秒（`*Ms` 后缀），由前端按契约字段名解释。
- 状态类字段必须是枚举类型，不能是 `String`：`SessionStatus`、`TransferStatus`、
  `TransferDirection` 都直接作为 DTO/事件字段类型，前端因此拿到字面量联合。
- 路径字面量（设置项 `path`）由 `gen-ipc.mjs` 的 `FIELD_TYPE_OVERRIDES` 收紧成
  `SettingPath` 联合；规则没命中就会报错，不会静默退化成 `string`。

## 5. 写入接口的严格校验

- 补丁式写接口（`update_settings`）**必须拒绝契约外字段**，返回
  `INVALID_ARGUMENT` + `details: string[]`（路径列表）。"忽略未知字段"的宽容等于
  允许设置项静默失效，属于禁止事项（AGENTS.md §13）。
- 越界/类型不符返回 `details: SettingViolation[]`（`{path,min,max,unit,received}`），
  前端据此把错误定位到具体控件；`received` 对字符串只报长度，不回显内容（脱敏）。
- 界面侧提交前先按契约区间做同口径本地校验（不该出现越界选项，但仍要拦），
  失败时保留用户刚选的值并展示后端原文，不吞错、不静默回滚。

## 6. 依赖与回滚

| 依赖 | 用途 | 风险 | 回滚 |
| ------ | ------ | ------ | ------ |
| `schemars`（Rust，普通依赖） | 由 serde 类型导出 JSON Schema。derive 出现在非测试代码，故不能放 dev-dependencies | 只在导出与设置 schema 中使用，无运行时业务逻辑；增加少量代码体积 | `cargo remove schemars` + 删除各类型上的 `schemars::JsonSchema` derive、`src-tauri/src/ipc_contract.rs`、`contract/` 工件 |
| `json-schema-to-typescript`（前端 devDependency） | 把 JSON Schema 编译为 TS | 仅 codegen 使用，不进产物 | `bun remove json-schema-to-typescript` + 删除 `scripts/gen-ipc.mjs`，前端类型退回手写 |

> 曾评估 `ts-rs`：它不读 `serde` 属性，需要在每个类型上再写一遍 `#[ts(rename_all=...)]`，
> 等于把同一份命名声明写两次 —— 与本规范的第 1 条不变量冲突，故不采用。

## 7. 本规范诞生的事故（回归样本）

- 前端手写 `AppSettings.transfer.chunkSizeKiB`（大写 B），Rust `chunk_size_kib`
  经 `rename_all="camelCase"` 实际产出 `chunkSizeKib` → 读取恒为 `undefined`；
  保存时 `chunkSizeKiB` 被 serde 当未知字段丢弃 → "分块大小"从能看到能改，
  但永远不生效。旧代码用 `Number(undefined) || 32` 把它伪装成"正常"。
- 同族问题：`line_height: f32` 序列化成 `1.2000000476837158` 污染契约与配置文件；
  状态字段用 `String` 导致前端只能手写一份枚举联合；数值区间在 Rust `validate()`
  与前端档位常量里各写一遍。
- 现在的防线：类型来自生成物（写错字段名编译不过）、`update_settings` 拒绝未知字段
  （静默失效变显式报错）、区间与档位同源、`contract.test.ts` + `ipc_contract.rs`
  两组守卫用例锁住这些事实。

## 8. 检查清单（评审与自测逐条过）

- [ ] 新字段/新类型只在 Rust 定义，并已在 `ipc_contract.rs` 登记
- [ ] 跑过 `bun run gen:ipc`，`src/types/gen/` 有对应产出
- [ ] 前端只在 `src/types/<module>.ts` 起别名，没有手写形状
- [ ] 数值区间/枚举候选只出现在 Rust 一处（`schema.rs` 或枚举本身）
- [ ] `*Id` 仍是 string；状态类字段是枚举而不是 `String`
- [ ] 写接口拒绝契约外字段，错误带结构化 `details`
- [ ] `cargo test --lib` / `bun run check:ipc` / `bunx tsc --noEmit` / `bun run test` 全绿
