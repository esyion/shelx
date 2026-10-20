/**
 * IPC 契约代码生成(AGENTS.md §5:跨边界类型只有后端一处定义)。
 *
 * 流水线:
 *   1. `cargo test --lib` 的两个导出用例从 Rust 类型产出两份工件:
 *      - `src-tauri/contract/ipc-schema.json`:全部边界类型的 JSON Schema
 *        (serde 的 rename_all / 枚举字面量在这里是唯一真值,不需要第二处声明);
 *      - `src-tauri/contract/settings-contract.json`:设置项的运行时数据
 *        (schema 表 + 默认值),供设置界面渲染控件与档位测试基线。
 *   2. 本脚本把 JSON Schema 逐模块编译成 `src/types/gen/<module>.ts`。
 *   3. `src/types/<module>.ts` 只做再导出与前端别名,禁止再手写后端字段。
 *
 * 用法:
 *   bun run gen:ipc    # 重新导出并生成(改了 Rust DTO 后执行)
 *   bun run check:ipc  # 校验两份工件与生成物都没过期(门禁用)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(root, "src-tauri", "contract", "ipc-schema.json");
const genDir = join(root, "src", "types", "gen");

/** 跑一条命令,失败即退出(打印 stderr 便于定位)。 */
function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`${command} ${args.join(" ")} 失败\n${result.stderr ?? ""}${result.stdout ?? ""}`);
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

/** 步骤 1:导出契约工件(check 模式只验证未过期,不写文件)。 */
function exportArtifacts(check) {
  const args = [
    "test",
    "--manifest-path",
    join("src-tauri", "Cargo.toml"),
    "--lib",
    "ipc_contract",
  ];
  if (check) {
    // 过滤条件命中 0 条测试时 cargo 仍返回 0,必须显式断言真的跑过校验。
    assertTestsRan(run("cargo", args));
    run("cargo", [
      "test",
      "--manifest-path",
      join("src-tauri", "Cargo.toml"),
      "--lib",
      "settings_contract_fixture",
    ]);
    return;
  }
  const env = { SHELX_UPDATE_CONTRACT: "1" };
  assertTestsRan(run("cargo", args, env));
  run("cargo", [
    "test",
    "--manifest-path",
    join("src-tauri", "Cargo.toml"),
    "--lib",
    "settings_contract_fixture",
  ], env);
}

/** 断言 cargo 过滤条件至少命中一条测试(防止筛改名后静默跳过导出)。 */
function assertTestsRan(output) {
  const passed = [...output.matchAll(/(\d+) passed/g)].reduce(
    (sum, match) => sum + Number(match[1]),
    0,
  );
  if (passed === 0) {
    throw new Error("契约导出用例一条都没跑到(测试筛名失效),请检查 gen-ipc.mjs 的过滤条件");
  }
}

/**
 * 字段类型收紧表:JSON Schema 只能表达"字符串 + pattern",
 * 而取值集合本身也是后端数据(设置项路径清单来自 `settings_schema()`),
 * 因此把这类字段指到由同一份契约生成的字面量联合上,让前端写错路径直接编译失败。
 * 规则必须命中,否则报错 —— 不允许静默漏收紧。
 */
const FIELD_TYPE_OVERRIDES = [
  {
    module: "settings",
    pattern: /^(\s*)path: string;$/gm,
    replacement: "$1path: SettingPath;",
    imports: [{ name: "SettingPath", from: "./settingPaths" }],
  },
];

/** 应用字段类型收紧,并补齐所需 import(返回原文不变表示没有规则命中)。 */
function applyOverrides(module, text) {
  let output = text;
  const addedImports = [];
  for (const rule of FIELD_TYPE_OVERRIDES) {
    if (rule.module !== module) continue;
    const replaced = output.replace(rule.pattern, rule.replacement);
    if (replaced === output) {
      throw new Error(`字段类型收紧规则未命中(${module}),生成脚本需要同步更新`);
    }
    output = replaced;
    addedImports.push(...rule.imports);
  }
  if (addedImports.length === 0) return output;
  const names = addedImports.map((item) => item.name).join(", ");
  const from = addedImports[0].from;
  const headerRe = /^(\/\*[\s\S]*?\*\/\n)/;
  return output.replace(
    headerRe,
    `$1\nimport type { ${names} } from "${from}";\n`,
  );
}

/** 模块名 → 生成文件名(保持 camelCase,与 Rust 模块一致)。 */
function fileName(module) {
  return `${module}.ts`;
}

/**
 * 去掉 `$ref` 的兄弟 `description`(JSON Schema 2020-12 规定 $ref 兄弟关键字被忽略)。
 * schemars 会把字段 doc 注释挂在 $ref 旁边,json-schema-to-typescript 因此
 * 为同一类型再生成一个 `Xxx1` 别名,导致契约类型出现重复名字。
 */
function normalizeRefs(node) {
  if (Array.isArray(node)) return node.map(normalizeRefs);
  if (node && typeof node === "object") {
    const result = {};
    for (const [key, value] of Object.entries(node)) {
      if (node.$ref !== undefined && (key === "description" || key === "title")) continue;
      result[key] = normalizeRefs(value);
    }
    return result;
  }
  return node;
}

/** 从编译结果里剥掉 JSTS 为"注册表"根对象生成的外壳,只保留具名类型。 */
function stripRegistryRoot(text, rootName) {
  const withoutRoot = text.replace(
    new RegExp(`export interface ${rootName} \\{[\\s\\S]*?\\n\\}\\n`),
    "",
  );
  return withoutRoot.replace(new RegExp(`export default ${rootName};?\\n?`), "");
}

/** 步骤 2:逐模块编译 TS 类型。 */
async function generate(check) {
  const document = JSON.parse(readFileSync(schemaPath, "utf8"));
  if (document.version === 0) {
    console.error("IPC 契约是占位内容(version 0),先运行 bun run gen:ipc");
    process.exit(1);
  }
  if (!check) mkdirSync(genDir, { recursive: true });
  const failures = [];
  for (const [module, schema] of Object.entries(document.modules)) {
    const rootName = `${module.charAt(0).toUpperCase()}${module.slice(1)}Registry`;
    const compiled = await compile(
      normalizeRefs({ ...schema, title: rootName }),
      rootName,
      {
        bannerComment:
          "/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。\n   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */",
        unknownAny: false,
        additionalProperties: false,
        enableConstEnums: false,
        style: { semicolons: true, singleQuote: false },
      },
    );
    const body = applyOverrides(
      module,
      stripRegistryRoot(compiled, rootName).trimEnd(),
    );
    const outPath = join(genDir, fileName(module));
    const text = `${body}\n`;
    if (check) {
      let current = "";
      try {
        current = readFileSync(outPath, "utf8");
      } catch {
        failures.push(`${relative(root, outPath)} 缺失`);
        continue;
      }
      if (current !== text) failures.push(`${relative(root, outPath)} 已过期`);
    } else {
      writeFileSync(outPath, text, "utf8");
    }
  }
  if (check && failures.length > 0) {
    console.error(`契约生成物与 Rust 类型不一致:\n${failures.join("\n")}\n请运行 bun run gen:ipc`);
    process.exit(1);
  }
}

/** 清理:删掉 schema 里已不存在的旧生成物,避免留下过期镜像。 */
function pruneStaleFiles(documentModules) {
  const keep = new Set([...documentModules].map((module) => fileName(module)));
  let entries;
  try {
    entries = readdirSync(genDir);
  } catch {
    return; // 首次生成前目录不存在
  }
  for (const entry of entries) {
    if (entry.endsWith(".ts") && entry !== "index.ts" && !keep.has(entry)) {
      rmSync(join(genDir, entry));
    }
  }
}

/**
 * 设置项路径联合类型:来自 `settings-contract.json` 的运行时 schema 数据。
 *
 * 类型文档(ipc-schema)里 `path` 只是带 pattern 的字符串,取不到字面量集合;
 * 路径清单本身是后端数据(`settings_schema()`),因此从这份数据工件生成,
 * 让前端文案表的 key 仍然写错就编译失败。
 */
async function generateSettingPaths(check) {
  const dataPath = join(root, "src-tauri", "contract", "settings-contract.json");
  const contract = JSON.parse(readFileSync(dataPath, "utf8"));
  const paths = contract.schema.map((spec) => spec.path);
  const text = `/* 由 \`bun run gen:ipc\` 从 src-tauri/contract/settings-contract.json 生成,请勿手改。 */\n\n/** 设置项路径(与 Rust serde 产物逐字一致;新增设置项自动出现在这里)。 */\nexport type SettingPath =\n${paths.map((path) => `  | ${JSON.stringify(path)}`).join("\n")};\n`;
  const outPath = join(genDir, "settingPaths.ts");
  if (check) {
    let current = "";
    try {
      current = readFileSync(outPath, "utf8");
    } catch {
      console.error(`${relative(root, outPath)} 缺失,请运行 bun run gen:ipc`);
      process.exit(1);
    }
    if (current !== text) {
      console.error(`${relative(root, outPath)} 已过期,请运行 bun run gen:ipc`);
      process.exit(1);
    }
    return;
  }
  writeFileSync(outPath, text, "utf8");
}

const check = process.argv.includes("--check");
exportArtifacts(check);
if (!check) mkdirSync(genDir, { recursive: true });
const doc = JSON.parse(readFileSync(schemaPath, "utf8"));
if (!check) pruneStaleFiles(Object.keys(doc.modules));
await generate(check);
await generateSettingPaths(check);
console.log(
  check
    ? "IPC 契约与生成物一致"
    : `已生成 ${Object.keys(doc.modules).length} 个模块到 ${relative(root, genDir)}`,
);
