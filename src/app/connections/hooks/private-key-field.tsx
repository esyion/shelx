/**
 * 私钥文件选择字段:默认从本机 ~/.ssh 列出候选私钥(过滤 .pub 与目录)供挑选,
 * 同时保留"手动输入其他路径"的自由输入分支。
 *
 * 体验约束(产品硬规则:不要求用户懂 `~` 展开和密钥命名习惯):
 * - 选中或输入后在输入框回显完整绝对路径;
 * - `~/.ssh` 不存在/不可读时降级为一句灰色提示,而不是红色报错;
 * - 留空 = 后端自动尝试默认密钥(与 Rust `AuthMethod::PrivateKey` 缺省语义一致:
 *   依次尝试 `~/.ssh/id_ed25519`、`~/.ssh/id_rsa`)。
 */
"use client";

import { useEffect, useState } from "react";
import { localHomePath, listLocalEntries } from "@/app/api";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

/** 本机密钥扫描状态。 */
type ScanStatus = "loading" | "ready" | "unavailable";

/** 拼接目录与文件名(统一用 `/`;Rust 文件系统 API 在 Windows 也接受 `/`)。 */
function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, "")}/${name}`;
}

/** PrivateKeyField props:value 为当前路径(空串 = 使用默认密钥)。 */
export interface PrivateKeyFieldProps {
  value: string;
  onChange: (path: string) => void;
  /** 控件 DOM id(用于 aria 关联)。 */
  id?: string;
}

/** 私钥选择/输入控件。 */
export function PrivateKeyField({ value, onChange, id }: PrivateKeyFieldProps) {
  const [keys, setKeys] = useState<string[]>([]);
  const [status, setStatus] = useState<ScanStatus>("loading");

  /** 挂载时扫描 ~/.ssh;任何失败静默降级为手动输入分支,不打扰用户。 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const home = await localHomePath();
        const sshDir = joinPath(home, ".ssh");
        const entries = await listLocalEntries(sshDir);
        if (cancelled) return;
        const files = entries
          .filter((entry) => entry.fileType === "file" && !entry.name.endsWith(".pub"))
          .map((entry) => joinPath(sshDir, entry.name))
          .sort((a, b) => a.localeCompare(b));
        setKeys(files);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 列表不可用/为空时的引导文案(灰字,不是错误)。 */
  const scanHint =
    status === "loading"
      ? "正在查找本机已有的密钥…"
      : status === "unavailable" || keys.length === 0
        ? "未发现 ~/.ssh 中的已有密钥,可直接手动输入路径"
        : `已从 ~/.ssh 找到 ${keys.length} 个密钥,也可手动输入其他路径`;

  return (
    <div className="grid gap-1.5">
      <Combobox
        items={keys}
        value={value === "" ? null : value}
        onValueChange={(next) => onChange(next ?? "")}
        inputValue={value}
        onInputValueChange={(text) => onChange(text ?? "")}
      >
        <ComboboxInput
          id={id}
          showClear
          placeholder="选择私钥文件,或手动输入路径"
          className="text-xs"
        />
        <ComboboxContent>
          <ComboboxList>
            {keys.map((keyPath) => (
              <ComboboxItem key={keyPath} value={keyPath}>
                <span className="truncate text-xs">{keyPath}</span>
              </ComboboxItem>
            ))}
          </ComboboxList>
          <ComboboxEmpty>没有匹配的密钥,可直接输入路径</ComboboxEmpty>
        </ComboboxContent>
      </Combobox>
      <p className="text-xs text-muted-foreground">{scanHint}</p>
    </div>
  );
}
