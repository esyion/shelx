/**
 * 连接管理 IPC 契约镜像(与 Rust `dto::connection` 对齐,字段 camelCase,ID 一律 string)。
 * 凭据永不跨边界传输;`hasStoredPassword` 等布尔字段随 M1-B4 凭据存储一并补充。
 */

/** 认证方式。 */
export type AuthMethod =
  | "password"
  | "private_key"
  | "keyboard_interactive"
  | "agent";

/** 终端编码。 */
export type Encoding = "utf-8" | "gbk";

/** 连接记录;凭据本体永不跨边界,以 hasStored* 布尔表达保存状态。 */
export interface ConnectionDto {
  id: string;
  /** 所属分组;根目录为 null。 */
  groupId: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  privateKeyPath: string | null;
  /** 是否已保存密码(持久存储)。 */
  hasStoredPassword: boolean;
  /** 是否已保存私钥口令(持久存储)。 */
  hasStoredPassphrase: boolean;
  encoding: Encoding;
  tagColor: string | null;
  remark: string | null;
  position: number;
}

/** 连接树分组节点(kind 判别)。 */
export interface GroupNodeDto {
  kind: "group";
  id: string;
  name: string;
  position: number;
  children: ConnectionNodeDto[];
}

/** 连接树节点:分组或连接叶子。 */
export type ConnectionNodeDto =
  | GroupNodeDto
  | (ConnectionDto & { kind: "connection" });

/** 凭据保存方式(PRD §6.2)。 */
export type SecretSaveMode = "keyring" | "session" | "never";

/** 凭据输入:明文值 + 保存方式;仅随请求发送,永不随响应返回。 */
export interface CredentialInput {
  value: string;
  save: SecretSaveMode;
}

/** 连接新建/编辑请求体。 */
export interface ConnectionInput {
  groupId: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  privateKeyPath?: string | null;
  /** 密码输入;不传(或 null)表示本次不变更(更新语义)。 */
  password?: CredentialInput | null;
  /** 私钥口令输入;不传表示本次不变更。 */
  passphrase?: CredentialInput | null;
  /** 缺省后端回退 UTF-8。 */
  encoding?: Encoding;
  tagColor?: string | null;
  remark?: string | null;
}

/** 分组记录。 */
export interface GroupDto {
  id: string;
  name: string;
  position: number;
}

/** 分组删除策略。 */
export type DeleteGroupMode = "require-empty" | "promote-children";
