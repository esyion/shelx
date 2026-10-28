//! 本机工作区 DTO(与线程 DTO 分文件以守单文件行数约束,AGENTS.md §2/§5)。

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::agent::Millis;
use crate::application::workspaces::WorkspaceRecord;

/// 一个已登记的本机工作区。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    /// ID。
    pub id: String,
    /// 显示名(登记时未填则以目录名兜底)。
    pub name: String,
    /// 根目录(canonical 绝对路径)。
    pub root_path: String,
    /// 创建时间。
    pub created_at: Millis,
    /// 更新时间。
    pub updated_at: Millis,
    /// 最近一次被对话使用;从未用过为 null。
    pub last_used_at: Option<Millis>,
}

impl From<WorkspaceRecord> for WorkspaceDto {
    /// 应用层记录 → DTO。
    fn from(value: WorkspaceRecord) -> Self {
        Self {
            id: value.id,
            name: value.name,
            root_path: value.root,
            created_at: value.created_at,
            updated_at: value.updated_at,
            last_used_at: value.last_used_at,
        }
    }
}

/// 登记工作区请求。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddWorkspaceRequestDto {
    /// 根目录(系统目录选择器返回的绝对路径;必须存在且是目录)。
    pub root_path: String,
    /// 显示名(可空;空则用目录名兜底)。
    #[serde(default)]
    pub name: Option<String>,
}

/// 工作区 ID 请求。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceIdRequestDto {
    /// 工作区 ID。
    pub id: String,
}
