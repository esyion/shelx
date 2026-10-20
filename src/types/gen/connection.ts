/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。
   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */

/**
 * 认证方式(snake_case 字符串跨边界)。
 */
export type AuthMethodDto = "password" | "private_key" | "keyboard_interactive" | "agent";
/**
 * 终端编码(跨边界字符串与数据库枚举一致:'utf-8' / 'gbk')。
 */
export type EncodingDto = "utf-8" | "gbk";
/**
 * 凭据保存方式(snake_case 跨边界)。
 */
export type SecretSaveModeDto = "keyring" | "session" | "never";
/**
 * 连接树节点;`kind` 判别("group" / "connection")。
 */
export type ConnectionNodeDto =
  | {
      /**
       * 子节点。
       */
      children: ConnectionNodeDto[];
      /**
       * 分组 ID。
       */
      id: string;
      kind: "group";
      /**
       * 名称。
       */
      name: string;
      /**
       * 同级排序位置。
       */
      position: number;
    }
  | {
      authMethod: AuthMethodDto;
      encoding: EncodingDto;
      /**
       * 所属分组 ID;根目录为 null。
       */
      groupId: string | null;
      /**
       * 是否已保存私钥口令(持久存储)。
       */
      hasStoredPassphrase: boolean;
      /**
       * 是否已保存密码(持久存储)。
       */
      hasStoredPassword: boolean;
      /**
       * 主机。
       */
      host: string;
      /**
       * 连接 ID。
       */
      id: string;
      kind: "connection";
      /**
       * 显示名。
       */
      name: string;
      /**
       * 端口。
       */
      port: number;
      /**
       * 同级排序位置。
       */
      position: number;
      /**
       * 私钥路径。
       */
      privateKeyPath: string | null;
      /**
       * 备注。
       */
      remark: string | null;
      /**
       * 标签颜色。
       */
      tagColor: string | null;
      /**
       * 用户名。
       */
      username: string;
    };
/**
 * 删除分组策略(kebab-case 跨边界)。
 */
export type DeleteGroupModeDto = "require-empty" | "promote-children";

/**
 * 连接响应 DTO;凭据本体永不返回,以 `hasStored*` 布尔表达保存状态。
 */
export interface ConnectionDto {
  authMethod: AuthMethodDto;
  encoding: EncodingDto;
  /**
   * 所属分组 ID;根目录为 null。
   */
  groupId: string | null;
  /**
   * 是否已保存私钥口令(持久存储)。
   */
  hasStoredPassphrase: boolean;
  /**
   * 是否已保存密码(持久存储)。
   */
  hasStoredPassword: boolean;
  /**
   * 主机。
   */
  host: string;
  /**
   * 连接 ID。
   */
  id: string;
  /**
   * 显示名。
   */
  name: string;
  /**
   * 端口。
   */
  port: number;
  /**
   * 同级排序位置。
   */
  position: number;
  /**
   * 私钥路径。
   */
  privateKeyPath: string | null;
  /**
   * 备注。
   */
  remark: string | null;
  /**
   * 标签颜色。
   */
  tagColor: string | null;
  /**
   * 用户名。
   */
  username: string;
}
/**
 * 连接新建/编辑请求体;encoding/tagColor 缺省时回退默认值,
 * password/passphrase 为 `None` 时表示保留既有凭据(更新语义)。
 */
export interface ConnectionInputDto {
  authMethod: AuthMethodDto;
  /**
   * 编码;缺省 UTF-8。
   */
  encoding: EncodingDto | null;
  /**
   * 所属分组;null 为根目录。
   */
  groupId: string | null;
  /**
   * 主机(必填)。
   */
  host: string;
  /**
   * 显示名(必填)。
   */
  name: string;
  /**
   * 私钥口令输入;null 表示本次不变更。
   */
  passphrase: CredentialInputDto | null;
  /**
   * 密码输入;null 表示本次不变更。
   */
  password: CredentialInputDto | null;
  /**
   * 端口(1–65535);收宽类型 i64,越界在转换时校验并返回信封内错误,
   * 避免 serde 拒绝时绕过 IpcResult 契约。
   */
  port: number;
  /**
   * 私钥路径。
   */
  privateKeyPath: string | null;
  /**
   * 备注。
   */
  remark: string | null;
  /**
   * 标签颜色。
   */
  tagColor: string | null;
  /**
   * 用户名(必填)。
   */
  username: string;
}
/**
 * 凭据输入:明文值 + 保存方式;仅随请求进入,永不随响应返回。
 */
export interface CredentialInputDto {
  save: SecretSaveModeDto;
  /**
   * 凭据明文。
   */
  value: string;
}
/**
 * 新建分组请求体。
 */
export interface CreateGroupRequestDto {
  /**
   * 分组名。
   */
  name: string;
  /**
   * 父分组;null 为根级。
   */
  parentId: string | null;
}
/**
 * 删除分组请求体。
 */
export interface DeleteGroupRequestDto {
  /**
   * 分组 ID。
   */
  id: string;
  mode: DeleteGroupModeDto;
}
/**
 * 分组响应 DTO。
 */
export interface GroupDto {
  /**
   * 分组 ID。
   */
  id: string;
  /**
   * 名称。
   */
  name: string;
  /**
   * 同级排序位置。
   */
  position: number;
}
/**
 * 单 ID 请求体。
 */
export interface IdRequestDto {
  /**
   * 目标资源 ID。
   */
  id: string;
}
/**
 * 移动连接请求体。
 */
export interface MoveConnectionRequestDto {
  /**
   * 连接 ID。
   */
  id: string;
  /**
   * 目标排序位置;缺省追加到末尾。
   */
  position: number | null;
  /**
   * 目标分组;null 移到根目录。
   */
  targetGroupId: string | null;
}
/**
 * 移动分组请求体。
 */
export interface MoveGroupRequestDto {
  /**
   * 分组 ID。
   */
  id: string;
  /**
   * 目标排序位置;缺省追加到末尾。
   */
  position: number | null;
  /**
   * 目标父分组;null 移到根级。
   */
  targetParentId: string | null;
}
/**
 * 重命名分组请求体。
 */
export interface RenameGroupRequestDto {
  /**
   * 分组 ID。
   */
  id: string;
  /**
   * 新名称。
   */
  name: string;
}
/**
 * 更新连接请求体。
 */
export interface UpdateConnectionRequestDto {
  /**
   * 目标连接 ID。
   */
  id: string;
  input: ConnectionInputDto;
}
