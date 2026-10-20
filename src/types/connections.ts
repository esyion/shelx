/**
 * 连接管理契约类型:字段与取值全部来自 Rust 生成物(`gen/connection.ts`)。
 *
 * 本文件只做前端命名的再导出与别名,禁止在此手写后端字段
 * (AGENTS.md §5;改名请改 Rust DTO 后 `bun run gen:ipc`)。
 */
export type {
  AuthMethodDto,
  ConnectionDto,
  ConnectionInputDto,
  ConnectionNodeDto,
  CreateGroupRequestDto,
  CredentialInputDto,
  DeleteGroupModeDto,
  DeleteGroupRequestDto,
  EncodingDto,
  GroupDto,
  IdRequestDto,
  MoveConnectionRequestDto,
  MoveGroupRequestDto,
  RenameGroupRequestDto,
  SecretSaveModeDto,
  UpdateConnectionRequestDto,
} from "./gen/connection";

import type { ConnectionNodeDto } from "./gen/connection";

/** 认证方式。 */
export type AuthMethod = import("./gen/connection").AuthMethodDto;
/** 终端编码。 */
export type Encoding = import("./gen/connection").EncodingDto;
/** 凭据保存方式。 */
export type SecretSaveMode = import("./gen/connection").SecretSaveModeDto;
/** 删除分组策略。 */
export type DeleteGroupMode = import("./gen/connection").DeleteGroupModeDto;
/** 凭据输入(明文值 + 保存方式,仅随请求发送)。 */
export type CredentialInput = import("./gen/connection").CredentialInputDto;
/** 连接新建/编辑请求体。 */
export type ConnectionInput = import("./gen/connection").ConnectionInputDto;
/** 分组节点(树里 `kind === "group"` 的分支)。 */
export type GroupNodeDto = Extract<ConnectionNodeDto, { kind: "group" }>;
/** 连接树节点(分组或连接叶子)。 */
export type ConnectionNode = ConnectionNodeDto;
