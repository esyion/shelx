//! SettingsService 单元测试:内存 fake 驱动默认回填、深合并、边界校验与布局约束。

use std::sync::Mutex;

use serde_json::json;

use super::super::ports::{SettingsStore, StoreError};
use super::{SettingsError, SettingsService};

/// 内存版设置端口(端口要求 Send + Sync,用 Mutex)。
#[derive(Default)]
struct FakeSettingsStore {
    settings: Mutex<Option<String>>,
    layout: Mutex<Option<String>>,
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
        Ok(self.layout.lock().expect("layout 锁").clone())
    }
    fn save_layout(&self, raw: &str) -> Result<(), StoreError> {
        *self.layout.lock().expect("layout 锁") = Some(raw.to_owned());
        Ok(())
    }
}

/// 构建被测服务。
fn service() -> SettingsService {
    SettingsService::new(Box::new(FakeSettingsStore::default()))
}

/// 从未保存时返回文档化默认值。
#[test]
fn returns_defaults_when_never_saved() {
    let settings = service().get().unwrap();
    assert_eq!(settings.terminal.scrollback, 5000);
    assert_eq!(
        settings.terminal.color_scheme,
        super::TerminalColorScheme::GithubLight
    );
    assert_eq!(settings.connection.keepalive_interval_secs, 30);
    assert_eq!(settings.transfer.max_concurrent_tasks, 2);
    assert_eq!(settings.monitor.default_interval_secs, 5);
}

/// 部分更新深合并:仅改动嵌套字段,其余保留。
#[test]
fn patch_deep_merges_and_persists() {
    let svc = service();
    svc.update(json!({ "terminal": { "fontSize": 15 } }))
        .unwrap();
    let settings = svc.get().unwrap();
    assert_eq!(settings.terminal.font_size, 15);
    assert_eq!(settings.terminal.scrollback, 5000, "未触及字段保留默认");

    // 再改外观,终端字段保留上次修改。
    svc.update(json!({ "appearance": { "theme": "dark" } }))
        .unwrap();
    let settings = svc.get().unwrap();
    assert_eq!(settings.appearance.theme, super::ThemeMode::Dark);
    assert_eq!(settings.terminal.font_size, 15);
}

/// 越界值被拒绝且不落盘。
#[test]
fn out_of_range_values_are_rejected() {
    let svc = service();
    let err = svc
        .update(json!({ "terminal": { "scrollback": 999_999_999 } }))
        .unwrap_err();
    assert!(matches!(err, SettingsError::Invalid(_)));
    assert_eq!(
        svc.get().unwrap().terminal.scrollback,
        5000,
        "拒绝后保持原值"
    );
}

/// 未知字段被忽略(向后兼容),类型错误被拒绝。
#[test]
fn unknown_fields_tolerated_and_type_mismatch_rejected() {
    let svc = service();
    svc.update(json!({ "futureOption": { "anything": true } }))
        .unwrap();
    assert!(svc
        .update(json!({ "terminal": { "fontSize": "大" } }))
        .is_err());
}

/// 配色方案补丁持久化;未知取值被拒绝且不落盘。
#[test]
fn color_scheme_patch_persists_and_unknown_rejected() {
    let svc = service();
    svc.update(json!({ "terminal": { "colorScheme": "dracula" } }))
        .unwrap();
    assert_eq!(
        svc.get().unwrap().terminal.color_scheme,
        super::TerminalColorScheme::Dracula
    );
    assert!(svc
        .update(json!({ "terminal": { "colorScheme": "hotdog" } }))
        .is_err());
    assert_eq!(
        svc.get().unwrap().terminal.color_scheme,
        super::TerminalColorScheme::Dracula,
        "拒绝后保持原值"
    );
}

/// 旧版设置缺 colorScheme 或存有已移除的 "default"(跟随应用)时,回退 GitHub Light。
#[test]
fn legacy_settings_fall_back_to_github_light() {
    let store = FakeSettingsStore::default();
    *store.settings.lock().expect("settings 锁") =
        Some(r#"{"terminal":{"fontSize":14}}"#.to_owned());
    let svc = SettingsService::new(Box::new(store));
    let settings = svc.get().unwrap();
    assert_eq!(settings.terminal.font_size, 14);
    assert_eq!(
        settings.terminal.color_scheme,
        super::TerminalColorScheme::GithubLight
    );

    let store = FakeSettingsStore::default();
    *store.settings.lock().expect("settings 锁") =
        Some(r#"{"terminal":{"colorScheme":"default"}}"#.to_owned());
    let svc = SettingsService::new(Box::new(store));
    assert_eq!(
        svc.get().unwrap().terminal.color_scheme,
        super::TerminalColorScheme::GithubLight
    );
}

/// 布局:非对象拒绝;对象透传持久化并可读回。
#[test]
fn layout_round_trip_and_shape_check() {
    let svc = service();
    assert!(svc.save_layout(json!([1, 2])).is_err());
    svc.save_layout(json!({ "sidebarCollapsed": true }))
        .unwrap();
    assert_eq!(svc.layout().unwrap()["sidebarCollapsed"], true);
}
