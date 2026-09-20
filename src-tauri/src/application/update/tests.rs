//! 自动检查更新用例测试:fake 端口验证调度决策(AGENTS.md §9,
//! 不依赖真实网络与 tauri-plugin-updater)。

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use super::{
    UpdateAutoCheckService, UpdateCheckError, UpdateChecker, UpdateEventSink, UpdateNotice,
    CHECK_INTERVAL, RETRY_INTERVAL,
};
use crate::application::ports::{SettingsStore, StoreError};
use crate::application::settings::SettingsService;

/// 脚本化检查结果 + 调用计数。
struct FakeChecker {
    result: Mutex<Result<Option<UpdateNotice>, UpdateCheckError>>,
    calls: AtomicUsize,
}

impl FakeChecker {
    fn new(result: Result<Option<UpdateNotice>, UpdateCheckError>) -> Self {
        Self {
            result: Mutex::new(result),
            calls: AtomicUsize::new(0),
        }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

#[async_trait::async_trait]
impl UpdateChecker for FakeChecker {
    async fn check(&self) -> Result<Option<UpdateNotice>, UpdateCheckError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let guard = self.result.lock().expect("检查结果锁");
        match &*guard {
            Ok(notice) => Ok(notice.clone()),
            Err(err) => Err(err.clone()),
        }
    }
}

/// 捕获通知的 sink。
#[derive(Default)]
struct CapturingSink {
    notices: Mutex<Vec<UpdateNotice>>,
}

impl UpdateEventSink for CapturingSink {
    fn available(&self, notice: &UpdateNotice) {
        self.notices.lock().expect("事件锁").push(notice.clone());
    }
}

impl CapturingSink {
    fn notices(&self) -> Vec<UpdateNotice> {
        self.notices.lock().expect("事件锁").clone()
    }
}

/// 内存设置存储;持有内部状态句柄以便测试中途切换设置。
struct FakeSettingsStore {
    raw: Arc<Mutex<Option<String>>>,
}

impl SettingsStore for FakeSettingsStore {
    fn load_settings(&self) -> Result<Option<String>, StoreError> {
        Ok(self.raw.lock().expect("设置锁").clone())
    }
    fn save_settings(&self, raw: &str) -> Result<(), StoreError> {
        *self.raw.lock().expect("设置锁") = Some(raw.to_owned());
        Ok(())
    }
    fn load_layout(&self) -> Result<Option<String>, StoreError> {
        Ok(None)
    }
    fn save_layout(&self, _raw: &str) -> Result<(), StoreError> {
        Ok(())
    }
}

/// 示例通知。
fn notice() -> UpdateNotice {
    UpdateNotice {
        current_version: "0.2.16".into(),
        version: "0.2.17".into(),
        notes: Some("- fix: 更新提示".into()),
        checked_at_ms: 1_758_000_000_000,
    }
}

/// 测试组装产物:服务、通知捕获、检查器、设置 JSON 句柄。
type TestService = (
    Arc<UpdateAutoCheckService>,
    Arc<CapturingSink>,
    Arc<FakeChecker>,
    Arc<Mutex<Option<String>>>,
);

/// 组装服务;返回 (服务, sink, checker, 设置 JSON 句柄)。
fn service_with(result: Result<Option<UpdateNotice>, UpdateCheckError>) -> TestService {
    let raw = Arc::new(Mutex::new(None));
    let settings = Arc::new(SettingsService::new(Box::new(FakeSettingsStore {
        raw: raw.clone(),
    })));
    let checker = Arc::new(FakeChecker::new(result));
    let sink = Arc::new(CapturingSink::default());
    let service = Arc::new(UpdateAutoCheckService::new(
        checker.clone(),
        sink.clone(),
        settings,
    ));
    (service, sink, checker, raw)
}

#[tokio::test]
async fn 发现新版本时通知并存档() {
    let (service, sink, _checker, _raw) = service_with(Ok(Some(notice())));

    let delay = service.run_once().await;

    assert_eq!(delay, CHECK_INTERVAL);
    assert_eq!(sink.notices(), vec![notice()]);
    assert_eq!(service.last_notice(), Some(notice()));
}

#[tokio::test]
async fn 已是最新不发通知() {
    let (service, sink, _checker, _raw) = service_with(Ok(None));

    let delay = service.run_once().await;

    assert_eq!(delay, CHECK_INTERVAL);
    assert!(sink.notices().is_empty());
    assert_eq!(service.last_notice(), None);
}

#[tokio::test]
async fn 检查失败走重试间隔且不发通知() {
    let (service, sink, _checker, _raw) = service_with(Err(UpdateCheckError("网络不可达".into())));

    let delay = service.run_once().await;

    assert_eq!(delay, RETRY_INTERVAL);
    assert!(sink.notices().is_empty());
    assert_eq!(service.last_notice(), None);
}

#[tokio::test]
async fn 开关关闭时跳过网络请求() {
    let (service, sink, checker, raw) = service_with(Ok(Some(notice())));
    *raw.lock().expect("设置锁") = Some(r#"{"update":{"autoCheck":false}}"#.into());

    let delay = service.run_once().await;

    assert_eq!(delay, CHECK_INTERVAL);
    assert_eq!(checker.calls(), 0);
    assert!(sink.notices().is_empty());
}

#[tokio::test]
async fn 每轮重读开关_中途关闭即刻生效() {
    let (service, sink, checker, raw) = service_with(Ok(Some(notice())));

    assert_eq!(service.run_once().await, CHECK_INTERVAL);
    assert_eq!(checker.calls(), 1);

    *raw.lock().expect("设置锁") = Some(r#"{"update":{"autoCheck":false}}"#.into());
    assert_eq!(service.run_once().await, CHECK_INTERVAL);
    // 关闭后不再发起检查,也不新增通知。
    assert_eq!(checker.calls(), 1);
    assert_eq!(sink.notices().len(), 1);
}

#[test]
fn 通知载荷为驼峰契约() {
    let json = serde_json::to_string(&notice()).expect("序列化");
    assert!(json.contains("\"currentVersion\""));
    assert!(json.contains("\"checkedAtMs\""));

    let parsed: UpdateNotice = serde_json::from_str(&json).expect("反序列化");
    assert_eq!(parsed, notice());
}
