/**
 * 连接表单的选项文案常量:认证方式与凭据保存方式。
 *
 * 文案面向普通用户,直接说明"选了这个会发生什么",不暴露 SSH/OS 内部术语。
 * 语义严格对齐 Rust 端实现,不是猜测:
 * - 认证方式: `src-tauri/src/domain/connection.rs` 的 `AuthMethod` 与
 *   `application/sessions/mod.rs::build_params`(密码/私钥缺省自动尝试
 *   `~/.ssh/id_ed25519`、`id_rsa`/键盘交互弹窗/agent 免密)。
 * - 保存方式: `application/connections/credentials.rs` 的
 *   Keyring(写系统凭据库,下次自动使用)/ Session(仅存进程内存,
 *   重启即失、UI 不显示已保存)/ Never(不保存并清除既有持久与会话凭据)。
 */
import type { AuthMethod, SecretSaveMode } from "@/types";

/** 认证方式选项:value 与 IPC 契约一致,label 是用户语言,hint 解释后果。 */
export interface AuthMethodOption {
  value: AuthMethod;
  label: string;
  hint: string;
}

/** 认证方式选项列表(顺序即下拉顺序)。 */
export const AUTH_METHOD_OPTIONS: AuthMethodOption[] = [
  {
    value: "password",
    label: "密码登录",
    hint: "使用服务器管理员给你的账号和密码,在下方填写密码即可。",
  },
  {
    value: "private_key",
    label: "私钥登录(更安全)",
    hint: "使用你电脑上的密钥文件登录,可直接挑选 ~/.ssh 里已有的密钥,无需记住路径。",
  },
  {
    value: "keyboard_interactive",
    label: "动态验证码(如手机口令)",
    hint: "服务器要求在登录时输入一次性验证码;连接时会弹窗请你按提示输入,无需在此填写凭据。",
  },
  {
    value: "agent",
    label: "用我本机已有的 SSH 配置",
    hint: "使用本机已配置好的密钥(ssh-agent 或默认密钥);无需在本软件里填写任何凭据。",
  },
];

/** 凭据保存方式选项:label 自带后果说明。 */
export interface SecretSaveOption {
  value: SecretSaveMode;
  label: string;
}

/** 凭据(密码/私钥口令)保存方式选项。 */
export const SECRET_SAVE_OPTIONS: SecretSaveOption[] = [
  { value: "keyring", label: "存到系统凭据库(下次自动使用,推荐)" },
  { value: "session", label: "只在本次使用(关闭应用后需重新输入)" },
  { value: "never", label: "不保存(并清除之前为该连接存过的密码)" },
];

/** 取当前认证方式对应的选项(找不到时按密码兜底,保证 UI 不空白)。 */
export function authMethodOption(value: AuthMethod): AuthMethodOption {
  return (
    AUTH_METHOD_OPTIONS.find((option) => option.value === value) ??
    AUTH_METHOD_OPTIONS[0]!
  );
}
