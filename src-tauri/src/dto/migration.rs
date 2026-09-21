//! 数据迁移 IPC DTO:与 `application::migration` 状态一一映射,字段 camelCase。
//!
//! id 为注册表稳定标识(字符串);路径为字符串形式,仅供展示,前端不得据此操作文件。

use serde::Serialize;

use crate::application::migration::{MigrationItemView, MigrationStatus};

/// 数据目录来源。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DataDirSourceDto {
    /// 标准新位置(`~/.shelx`)。
    Default,
    /// 历史位置(`~/.agents-plus/shelx`)。
    Legacy,
}

/// 单条待迁移内容。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataMigrationItem {
    /// 条目名称(如「连接与分组配置(SQLite 数据库)」)。
    pub label: String,
    /// 体量说明(如「约 320 KB」);无则省略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// 待执行的数据迁移。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataMigration {
    /// 稳定迁移 id(批准/忽略均回传此值)。
    pub id: String,
    /// 标题。
    pub title: String,
    /// 说明文案。
    pub description: String,
    /// 迁移源目录(当前旧位置,字符串仅供展示)。
    pub source_dir: String,
    /// 迁移目标目录(标准新位置)。
    pub target_dir: String,
    /// 实际存在的内容清单。
    pub items: Vec<DataMigrationItem>,
}

/// 迁移状态(自动弹窗条件 = `pending` 非空且 `autoPromptSuppressed` 为 false)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataMigrationStatus {
    /// 本进程实际使用的数据目录。
    pub data_dir: String,
    /// 数据目录来源。
    pub data_dir_source: DataDirSourceDto,
    /// 待执行的迁移;无旧数据时为 null。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending: Option<DataMigration>,
    /// 用户已「暂不」或已批准(待重启执行);自动弹窗应跳过,设置页入口不受影响。
    pub auto_prompt_suppressed: bool,
}

impl From<&MigrationItemView> for DataMigrationItem {
    fn from(item: &MigrationItemView) -> Self {
        Self {
            label: item.label.clone(),
            detail: item.detail.clone(),
        }
    }
}

impl From<&MigrationStatus> for DataMigrationStatus {
    fn from(status: &MigrationStatus) -> Self {
        Self {
            data_dir: status.data_dir.display().to_string(),
            data_dir_source: if status.legacy {
                DataDirSourceDto::Legacy
            } else {
                DataDirSourceDto::Default
            },
            pending: status.pending.as_ref().map(|pending| DataMigration {
                id: pending.id.to_owned(),
                title: pending.title.to_owned(),
                description: pending.description.to_owned(),
                source_dir: pending.source_dir.display().to_string(),
                target_dir: pending.target_dir.display().to_string(),
                items: pending.items.iter().map(Into::into).collect(),
            }),
            auto_prompt_suppressed: status.auto_prompt_suppressed,
        }
    }
}
