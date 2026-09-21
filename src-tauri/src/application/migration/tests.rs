//! MigrationService 单元测试:fake 设置端口 + fake 盘点端口驱动状态/批准/忽略用例。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use super::{MigrationError, MigrationService, DATA_DIR_MIGRATION_ID};
use crate::application::ports::{
    DataInventory, DataInventoryEntry, DataKind, SettingsStore, StoreError,
};
use crate::application::settings::SettingsService;
use crate::shared::paths::{DataDirResolution, DataDirSource};

/// 共享的设置落盘槽位(测试断言用)。
type SettingsSlot = Arc<Mutex<Option<String>>>;

/// 内存版设置端口。
struct FakeSettingsStore {
    settings: SettingsSlot,
}

impl FakeSettingsStore {
    /// 以共享槽位构造。
    fn new(settings: SettingsSlot) -> Self {
        Self { settings }
    }
}

impl SettingsStore for FakeSettingsStore {
    fn load_settings(&self) -> Result<Option<String>, StoreError> {
        Ok(self.settings.lock().expect("settings 锁").clone())
    }
    fn save_settings(&self, raw: &str) -> Result<(), StoreError> {
        *self.settings.lock().expect("settings 锁") = Some(raw.to_owned());
        Ok(())
    }
    fn load_layout(&self) -> Result<Option<String>, StoreError> {
        Ok(None)
    }
    fn save_layout(&self, _raw: &str) -> Result<(), StoreError> {
        Ok(())
    }
}

/// 固定盘点结果。
struct FakeInventory(Vec<DataInventoryEntry>);

impl DataInventory for FakeInventory {
    fn inventory(&self, _dir: &std::path::Path) -> Vec<DataInventoryEntry> {
        self.0.clone()
    }
}

/// 构造解析结果。
fn resolution(source: DataDirSource) -> DataDirResolution {
    DataDirResolution {
        dir: PathBuf::from("/home/u/.agents-plus/shelx"),
        default_dir: PathBuf::from("/home/u/.shelx"),
        source,
    }
}

/// 构建服务与设置落盘槽位。
fn service(source: DataDirSource) -> (MigrationService, SettingsSlot) {
    let slot: SettingsSlot = Arc::new(Mutex::new(None));
    let settings = Arc::new(SettingsService::new(Box::new(FakeSettingsStore::new(
        slot.clone(),
    ))));
    let service = MigrationService::new(
        settings,
        Box::new(FakeInventory(vec![DataInventoryEntry {
            kind: DataKind::Database,
            total_bytes: 321_000,
            file_count: 1,
        }])),
        &resolution(source),
    );
    (service, slot)
}

/// legacy 来源:status 返回待迁移项、内容清单与来源/目标路径。
#[test]
fn legacy_status_reports_pending_with_items() {
    let (service, _) = service(DataDirSource::Legacy);
    let status = service.status();
    assert!(status.legacy);
    let pending = status.pending.expect("legacy 应有待迁移项");
    assert_eq!(pending.id, DATA_DIR_MIGRATION_ID);
    assert_eq!(
        pending.source_dir,
        PathBuf::from("/home/u/.agents-plus/shelx")
    );
    assert_eq!(pending.target_dir, PathBuf::from("/home/u/.shelx"));
    assert_eq!(pending.items.len(), 1);
    assert_eq!(pending.items[0].label, "连接与分组配置(SQLite 数据库)");
    assert_eq!(pending.items[0].detail.as_deref(), Some("约 314 KB"));
    assert!(!status.auto_prompt_suppressed);
}

/// 默认来源(全新/已迁移):pending 为空,批准被拒绝。
#[test]
fn default_source_has_no_pending() {
    let (service, _) = service(DataDirSource::Default);
    let status = service.status();
    assert!(!status.legacy);
    assert!(status.pending.is_none());
    assert_eq!(
        service.approve(DATA_DIR_MIGRATION_ID),
        Err(MigrationError::Invalid("当前没有可迁移的旧数据".into()))
    );
}

/// 批准:pendingMigrationId 落盘;重复批准幂等;未知 id 拒绝。
#[test]
fn approve_persists_pending_marker() {
    let (service, slot) = service(DataDirSource::Legacy);
    service.approve(DATA_DIR_MIGRATION_ID).unwrap();
    let raw = slot.lock().expect("settings 锁").clone().unwrap();
    assert!(
        raw.contains("pendingMigrationId"),
        "应写入待执行标记: {raw}"
    );

    // 批准后仍处于 legacy(重启前),再批准应幂等成功。
    service.approve(DATA_DIR_MIGRATION_ID).unwrap();

    assert_eq!(
        service.approve("no-such-migration"),
        Err(MigrationError::Unknown("no-such-migration".into()))
    );
}

/// 暂不:写入忽略清单;批准后自动弹窗被抑制;重复暂不幂等;未知 id 拒绝。
#[test]
fn dismiss_suppresses_auto_prompt() {
    let (dismissed, slot) = service(DataDirSource::Legacy);
    assert!(!dismissed.status().auto_prompt_suppressed);

    dismissed.dismiss(DATA_DIR_MIGRATION_ID).unwrap();
    assert!(
        dismissed.status().auto_prompt_suppressed,
        "暂不后自动弹窗应被抑制"
    );
    dismissed.dismiss(DATA_DIR_MIGRATION_ID).unwrap();
    let raw = slot.lock().expect("settings 锁").clone().unwrap();
    assert_eq!(
        raw.matches(DATA_DIR_MIGRATION_ID).count(),
        1,
        "重复暂不应幂等: {raw}"
    );

    assert_eq!(
        dismissed.dismiss("no-such-migration"),
        Err(MigrationError::Unknown("no-such-migration".into()))
    );

    // 已批准(待重启)时同样抑制自动弹窗。
    let (approved, _) = service(DataDirSource::Legacy);
    approved.approve(DATA_DIR_MIGRATION_ID).unwrap();
    assert!(
        approved.status().auto_prompt_suppressed,
        "已批准待重启应抑制弹窗"
    );
}

/// 兜底文案:旧目录无已知数据时仍提供「应用数据」迁移项。
#[test]
fn unknown_legacy_content_falls_back_to_generic_item() {
    let slot: SettingsSlot = Arc::new(Mutex::new(None));
    let settings = Arc::new(SettingsService::new(Box::new(FakeSettingsStore::new(slot))));
    let service = MigrationService::new(
        settings,
        Box::new(FakeInventory(vec![])),
        &resolution(DataDirSource::Legacy),
    );
    let pending = service.status().pending.expect("应有待迁移项");
    assert_eq!(pending.items.len(), 1);
    assert_eq!(pending.items[0].label, "应用数据");
}
