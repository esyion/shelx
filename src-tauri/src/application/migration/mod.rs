//! 数据迁移用例(设计文档 §7.1):迁移注册表、状态查询与批准/忽略。
//!
//! 核心不变式:**任意时刻只写一个数据目录**。迁移期间应用继续用旧目录跑,
//! 新目录在 rename 前永远不会被写入,因此永远不需要数据合并。
//! 真正的切换发生在下次启动早期(见 `shared::paths`),本模块只负责:
//! 告诉前端"是否有待迁移数据、迁移哪些内容"(status)、
//! 记录用户的批准(approve → 下次启动 rename)与"暂不"(dismiss → 不再自动弹窗)。
//!
//! 扩展方式:未来新增数据迁移时,在 [`REGISTRY`] 追加一个 [`MigrationSpec`],
//! 并在启动流程为该 id 增加"启动早期执行"的分支;前端弹窗与设置页入口零改动。

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;

use crate::application::ports::{DataInventory, DataKind};
use crate::application::settings::{SettingsError, SettingsService};
use crate::shared::paths::{DataDirResolution, DataDirSource};

#[cfg(test)]
mod tests;

/// 当前唯一注册的数据迁移:数据目录从 `~/.agents-plus/shelx` 调整为 `~/.shelx`。
pub const DATA_DIR_MIGRATION_ID: &str = "data-dir-agents-plus-2026-09";

/// 迁移注册项:稳定 id + 弹窗文案 + 待执行条件。
///
/// id 跨版本稳定:用户的选择(批准/暂不)按 id 持久化,改文案不改 id。
pub struct MigrationSpec {
    /// 稳定唯一标识(camelCase DTO 中透传,前端不得自行构造)。
    pub id: &'static str,
    /// 弹窗/设置页标题。
    pub title: &'static str,
    /// 说明文案(简要交代位置调整与生效方式)。
    pub description: &'static str,
    /// 只读检测:该迁移当前是否待执行。
    pub is_pending: fn(&MigrationContext) -> bool,
}

/// 待执行条件判断所需的运行上下文。
pub struct MigrationContext {
    /// 本进程数据目录来源。
    pub source: DataDirSource,
    /// 本进程实际使用的数据目录。
    pub data_dir: PathBuf,
    /// 标准新位置(迁移目标)。
    pub default_dir: PathBuf,
}

/// 迁移注册表;未来新增迁移在此追加。
const REGISTRY: &[MigrationSpec] = &[MigrationSpec {
    id: DATA_DIR_MIGRATION_ID,
    title: "数据存储位置调整",
    description: "数据存储位置已从 ~/.agents-plus/shelx 调整为 ~/.shelx。\
                  迁移在重启应用时自动完成,耗时不足一秒。",
    is_pending: |ctx| ctx.source == DataDirSource::Legacy,
}];

/// 迁移用例错误。
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum MigrationError {
    /// id 不在注册表中。
    #[error("未知的数据迁移: {0}")]
    Unknown(String),
    /// 当前状态不允许该操作(如无旧数据时批准)。
    #[error("{0}")]
    Invalid(String),
    /// 设置持久化失败。
    #[error(transparent)]
    Settings(#[from] SettingsError),
}

/// 单条待迁移内容(弹窗与设置页的清单项)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationItemView {
    /// 条目名称(如「连接与分组配置(SQLite 数据库)」)。
    pub label: String,
    /// 体量说明(如「约 320 KB」「2 个文件」);无则省略。
    pub detail: Option<String>,
}

/// 一条待执行的迁移(spec 文案 + 动态盘点结果)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMigration {
    /// 稳定 id。
    pub id: &'static str,
    /// 标题。
    pub title: &'static str,
    /// 说明文案。
    pub description: &'static str,
    /// 迁移源目录(当前旧位置)。
    pub source_dir: PathBuf,
    /// 迁移目标目录(标准新位置)。
    pub target_dir: PathBuf,
    /// 实际存在的内容清单。
    pub items: Vec<MigrationItemView>,
}

/// 迁移状态查询结果(映射为 `dto::migration` 契约)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationStatus {
    /// 本进程实际使用的数据目录。
    pub data_dir: PathBuf,
    /// 本进程数据目录是否处于历史位置。
    pub legacy: bool,
    /// 待执行的迁移;非 legacy 时为 None。
    pub pending: Option<PendingMigration>,
    /// 用户已「暂不」或已批准(待重启执行)时为 true,自动弹窗应跳过。
    pub auto_prompt_suppressed: bool,
}

/// 数据迁移应用服务。
pub struct MigrationService {
    settings: Arc<SettingsService>,
    inventory: Box<dyn DataInventory>,
    data_dir: PathBuf,
    default_dir: PathBuf,
    source: DataDirSource,
}

impl MigrationService {
    /// 以设置服务、盘点端口与启动期目录解析结果构建服务。
    pub fn new(
        settings: Arc<SettingsService>,
        inventory: Box<dyn DataInventory>,
        resolution: &DataDirResolution,
    ) -> Self {
        Self {
            settings,
            inventory,
            data_dir: resolution.dir.clone(),
            default_dir: resolution.default_dir.clone(),
            source: resolution.source,
        }
    }

    /// 查询迁移状态;设置损坏时按无标记处理并记日志(状态查询不阻塞)。
    pub fn status(&self) -> MigrationStatus {
        let settings = self.settings_snapshot();
        let context = self.context();
        let pending = REGISTRY
            .iter()
            .find(|spec| (spec.is_pending)(&context))
            .map(|spec| PendingMigration {
                id: spec.id,
                title: spec.title,
                description: spec.description,
                source_dir: self.data_dir.clone(),
                target_dir: self.default_dir.clone(),
                items: self.items(),
            });
        let auto_prompt_suppressed = pending.as_ref().is_some_and(|p| {
            settings
                .migration
                .dismissed_auto_migrations
                .iter()
                .any(|id| id == p.id)
                || settings.migration.pending_migration_id.as_deref() == Some(p.id)
        });
        MigrationStatus {
            data_dir: self.data_dir.clone(),
            legacy: self.source == DataDirSource::Legacy,
            pending,
            auto_prompt_suppressed,
        }
    }

    /// 批准迁移:写入待执行标记,下次启动早期原子 rename 生效。
    ///
    /// # Errors
    /// - id 不在注册表([`MigrationError::Unknown`]);
    /// - 当前无待迁移数据([`MigrationError::Invalid`]);
    /// - 设置持久化失败([`MigrationError::Settings`])。
    pub fn approve(&self, id: &str) -> Result<(), MigrationError> {
        let spec = Self::spec(id).ok_or_else(|| MigrationError::Unknown(id.to_owned()))?;
        if !(spec.is_pending)(&self.context()) {
            return Err(MigrationError::Invalid("当前没有可迁移的旧数据".into()));
        }
        self.settings
            .update(json!({ "migration": { "pendingMigrationId": id } }))?;
        tracing::info!(migration = id, "用户批准数据迁移,下次启动执行");
        Ok(())
    }

    /// 「暂不」:把 id 加入不再自动弹窗清单(幂等);设置页手动入口不受影响。
    ///
    /// # Errors
    /// - id 不在注册表([`MigrationError::Unknown`]);
    /// - 设置持久化失败([`MigrationError::Settings`])。
    pub fn dismiss(&self, id: &str) -> Result<(), MigrationError> {
        Self::spec(id).ok_or_else(|| MigrationError::Unknown(id.to_owned()))?;
        let settings = self.settings.get()?;
        if settings
            .migration
            .dismissed_auto_migrations
            .iter()
            .any(|known| known == id)
        {
            return Ok(());
        }
        let mut dismissed = settings.migration.dismissed_auto_migrations.clone();
        dismissed.push(id.to_owned());
        self.settings
            .update(json!({ "migration": { "dismissedAutoMigrations": dismissed } }))?;
        tracing::info!(migration = id, "用户选择暂不迁移,关闭自动弹窗");
        Ok(())
    }

    /// 注册表查找。
    fn spec(id: &str) -> Option<&'static MigrationSpec> {
        REGISTRY.iter().find(|spec| spec.id == id)
    }

    /// 待执行条件上下文。
    fn context(&self) -> MigrationContext {
        MigrationContext {
            source: self.source,
            data_dir: self.data_dir.clone(),
            default_dir: self.default_dir.clone(),
        }
    }

    /// 读取设置快照;损坏时按默认值降级并记日志。
    fn settings_snapshot(&self) -> crate::application::settings::AppSettings {
        self.settings.get().unwrap_or_else(|err| {
            tracing::warn!(error = %err, "设置读取失败,迁移状态按无标记处理");
            crate::application::settings::AppSettings::default()
        })
    }

    /// 盘点旧目录实际内容并映射为展示文案;无已知数据时给出兜底项。
    fn items(&self) -> Vec<MigrationItemView> {
        let entries = self.inventory.inventory(&self.data_dir);
        let items: Vec<MigrationItemView> = entries
            .iter()
            .map(|entry| MigrationItemView {
                label: Self::label(entry.kind).to_owned(),
                detail: Self::detail(entry),
            })
            .collect();
        if items.is_empty() {
            // 目录存在但未识别出已知数据(如仅有未知文件):仍提供迁移入口。
            vec![MigrationItemView {
                label: "应用数据".to_owned(),
                detail: None,
            }]
        } else {
            items
        }
    }

    /// 类别 → 名称。
    fn label(kind: DataKind) -> &'static str {
        match kind {
            DataKind::Database => "连接与分组配置(SQLite 数据库)",
            DataKind::Logs => "应用日志",
            DataKind::DegradedSecrets => "降级加密凭据(仅钥匙串不可用时使用)",
        }
    }

    /// 类别 → 体量说明。
    fn detail(entry: &crate::application::ports::DataInventoryEntry) -> Option<String> {
        match entry.kind {
            DataKind::Logs => Some(format!("{} 个文件", entry.file_count)),
            DataKind::Database | DataKind::DegradedSecrets => {
                let kb = entry.total_bytes.div_ceil(1024);
                Some(format!("约 {kb} KB"))
            }
        }
    }
}
