//! 本机工作区用例:登记、列表、删除与"最近使用"(AGENTS.md §4.3 应用层)。
//!
//! 工作区是 Claude Code 式本机操作的边界载体:登记时由 [`WorkspaceFs::resolve_root`]
//! 把根解析成 canonical 形态落库,此后所有本机工具都以它为 confinement 边界。
//! 删除工作区时,对话绑定由数据库外键自动解绑(`ON DELETE SET NULL`),历史保留。

use std::sync::Arc;

use crate::application::agent::types::StoreFault;
use crate::application::local_ports::WorkspaceFs;
use crate::domain::agent::validate_workspace;

/// 一个已登记的本机工作区(ID 一律 string,时间戳 unix 毫秒,AGENTS.md §2/§5)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceRecord {
    /// 工作区 ID。
    pub id: String,
    /// 显示名(为空登记时已兜底为目录名)。
    pub name: String,
    /// 根目录(canonical 形态,confinement 边界)。
    pub root: String,
    /// 创建时间。
    pub created_at: i64,
    /// 更新时间。
    pub updated_at: i64,
    /// 最近一次被对话使用的时间(`None` = 从未用过;新对话默认取最近的)。
    pub last_used_at: Option<i64>,
}

/// 工作区持久化端口(实现见 `infrastructure/sqlite/workspace_repo.rs`)。
pub trait WorkspaceStore: Send + Sync {
    /// 全部工作区(按最近使用在前、未使用在后,再按名称)。
    ///
    /// # Errors
    /// 存储失败。
    fn list(&self) -> Result<Vec<WorkspaceRecord>, StoreFault>;

    /// 按 ID 查找。
    ///
    /// # Errors
    /// 存储失败。
    fn get(&self, id: &str) -> Result<Option<WorkspaceRecord>, StoreFault>;

    /// 新增(root 唯一索引冲突按错误返回,消息含"已是工作区")。
    ///
    /// # Errors
    /// 存储失败或 root 重复。
    fn insert(&self, workspace: &WorkspaceRecord) -> Result<(), StoreFault>;

    /// 删除(对话绑定由外键 `ON DELETE SET NULL` 自动解绑)。
    ///
    /// # Errors
    /// 存储失败。
    fn delete(&self, id: &str) -> Result<(), StoreFault>;

    /// 记录最近使用时间。
    ///
    /// # Errors
    /// 存储失败。
    fn touch_last_used(&self, id: &str, at: i64) -> Result<(), StoreFault>;
}

/// 工作区用例错误。
#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    /// 存储失败。
    #[error("{0}")]
    Store(#[from] StoreFault),
    /// 入参非法(消息面向用户)。
    #[error("{0}")]
    Invalid(String),
    /// 工作区不存在。
    #[error("工作区不存在")]
    NotFound,
    /// 根路径不可用(不存在或不是目录;消息面向用户)。
    #[error("{0}")]
    RootInvalid(String),
}

/// 工作区应用服务。
pub struct WorkspaceService {
    /// 持久化端口。
    store: Arc<dyn WorkspaceStore>,
    /// 受控文件系统端口(根解析与 confinement)。
    fs: Arc<dyn WorkspaceFs>,
}

impl WorkspaceService {
    /// 组装服务。
    #[must_use]
    pub fn new(store: Arc<dyn WorkspaceStore>, fs: Arc<dyn WorkspaceFs>) -> Self {
        Self { store, fs }
    }

    /// 全部工作区(最近使用在前)。
    ///
    /// # Errors
    /// 存储失败。
    pub fn list(&self) -> Result<Vec<WorkspaceRecord>, WorkspaceError> {
        Ok(self.store.list()?)
    }

    /// 按 ID 查找。
    ///
    /// # Errors
    /// 存储失败。
    pub fn get(&self, id: &str) -> Result<Option<WorkspaceRecord>, WorkspaceError> {
        Ok(self.store.get(id)?)
    }

    /// 登记工作区:根必须存在且是目录;名称为空时取根目录最后一段。
    /// 同一目录(root 唯一)只允许登记一次。
    ///
    /// # Errors
    /// 根不可用、名称/路径非法或存储失败。
    pub fn add(&self, name: &str, raw_root: &str) -> Result<WorkspaceRecord, WorkspaceError> {
        let root = self
            .fs
            .resolve_root(raw_root)
            .map_err(WorkspaceError::RootInvalid)?;
        let name = if name.trim().is_empty() {
            last_component(&root).ok_or_else(|| {
                WorkspaceError::Invalid("无法从路径推断工作区名称,请填写名称".into())
            })?
        } else {
            name.trim().to_owned()
        };
        if let Err(err) = validate_workspace(&name, &root) {
            return Err(WorkspaceError::Invalid(err.to_string()));
        }
        if self.store.list()?.iter().any(|ws| ws.root == root) {
            return Err(WorkspaceError::Invalid("该目录已是工作区".into()));
        }
        let now = crate::application::agent::now_millis();
        let record = WorkspaceRecord {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            root,
            created_at: now,
            updated_at: now,
            last_used_at: None,
        };
        self.store.insert(&record)?;
        Ok(record)
    }

    /// 删除工作区:绑定它的对话自动解绑,历史记录保留。
    ///
    /// # Errors
    /// 工作区不存在或存储失败。
    pub fn remove(&self, id: &str) -> Result<(), WorkspaceError> {
        if self.store.get(id)?.is_none() {
            return Err(WorkspaceError::NotFound);
        }
        self.store.delete(id)?;
        Ok(())
    }

    /// 最近使用的工作区(新对话的默认绑定)。
    #[must_use]
    pub fn most_recent(&self) -> Option<WorkspaceRecord> {
        self.store.list().ok()?.into_iter().next()
    }

    /// 记录"这个对话刚用了这个工作区"(失败只记日志,不打断运行)。
    pub fn touch_used(&self, id: &str) {
        let at = crate::application::agent::now_millis();
        if let Err(err) = self.store.touch_last_used(id, at) {
            tracing::warn!(workspace_id = %id, "工作区最近使用时间记录失败: {err}");
        }
    }
}

/// 取路径最后一段(两种分隔符都认;根路径返回 `None`)。
fn last_component(path: &str) -> Option<String> {
    path.rsplit(['/', '\\'])
        .find(|part| !part.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::local_ports::WorkspaceListing;
    use std::sync::Mutex as StdMutex;

    /// 内存假文件系统:任意输入都解析成"当前平台的绝对路径"(保持一一对应)。
    struct FakeFs;
    impl WorkspaceFs for FakeFs {
        fn resolve_root(&self, raw: &str) -> Result<String, String> {
            if raw.starts_with("bad:") {
                return Err(format!("目录不可用:{raw}"));
            }
            if cfg!(windows) {
                Ok(format!(r"C:\ws\{raw}"))
            } else {
                Ok(format!("/ws/{raw}"))
            }
        }
        fn read_text(&self, _: &str, _: &str, _: u64) -> Result<(String, bool), String> {
            unimplemented!("本测试不涉及")
        }
        fn list(&self, _: &str, _: &str) -> Result<Vec<WorkspaceListing>, String> {
            unimplemented!("本测试不涉及")
        }
        fn write(&self, _: &str, _: &str, _: &str, _: bool) -> Result<u64, String> {
            unimplemented!("本测试不涉及")
        }
        fn remove(&self, _: &str, _: &str) -> Result<(), String> {
            unimplemented!("本测试不涉及")
        }
        fn rename(&self, _: &str, _: &str, _: &str) -> Result<(), String> {
            unimplemented!("本测试不涉及")
        }
    }

    /// 内存假存储。
    struct FakeStore {
        rows: StdMutex<Vec<WorkspaceRecord>>,
    }
    impl WorkspaceStore for FakeStore {
        fn list(&self) -> Result<Vec<WorkspaceRecord>, StoreFault> {
            // 与真实存储同一排序契约:最近使用在前,未使用在后,再按名称。
            let mut rows = self.rows.lock().unwrap().clone();
            rows.sort_by(|a, b| {
                b.last_used_at
                    .cmp(&a.last_used_at)
                    .then_with(|| a.name.cmp(&b.name))
            });
            Ok(rows)
        }
        fn get(&self, id: &str) -> Result<Option<WorkspaceRecord>, StoreFault> {
            Ok(self
                .rows
                .lock()
                .unwrap()
                .iter()
                .find(|ws| ws.id == id)
                .cloned())
        }
        fn insert(&self, workspace: &WorkspaceRecord) -> Result<(), StoreFault> {
            self.rows.lock().unwrap().push(workspace.clone());
            Ok(())
        }
        fn delete(&self, id: &str) -> Result<(), StoreFault> {
            self.rows.lock().unwrap().retain(|ws| ws.id != id);
            Ok(())
        }
        fn touch_last_used(&self, id: &str, at: i64) -> Result<(), StoreFault> {
            if let Some(ws) = self.rows.lock().unwrap().iter_mut().find(|ws| ws.id == id) {
                ws.last_used_at = Some(at);
            }
            Ok(())
        }
    }

    fn service() -> (WorkspaceService, Arc<FakeStore>) {
        let store = Arc::new(FakeStore {
            rows: StdMutex::new(Vec::new()),
        });
        (
            WorkspaceService::new(store.clone(), Arc::new(FakeFs) as Arc<dyn WorkspaceFs>),
            store,
        )
    }

    #[test]
    fn add_falls_back_to_directory_name() {
        let (svc, _) = service();
        let ws = svc.add("", "proj-demo").unwrap();
        assert_eq!(ws.name, "proj-demo");
    }

    #[test]
    fn add_rejects_unusable_root() {
        let (svc, _) = service();
        assert!(matches!(
            svc.add("名", "bad:/missing"),
            Err(WorkspaceError::RootInvalid(_))
        ));
    }

    #[test]
    fn add_rejects_duplicate_root() {
        let (svc, _) = service();
        svc.add("一", "same").unwrap();
        assert!(matches!(
            svc.add("二", "same"),
            Err(WorkspaceError::Invalid(msg)) if msg.contains("已是工作区")
        ));
    }

    #[test]
    fn most_recent_follows_touch_order() {
        let (svc, store) = service();
        let a = svc.add("a", "dir-a").unwrap();
        let b = svc.add("b", "dir-b").unwrap();
        let (a_id, b_id) = (a.id.clone(), b.id.clone());
        assert_eq!(svc.most_recent().map(|ws| ws.id), Some(a_id));
        svc.touch_used(&b_id);
        assert_eq!(svc.most_recent().map(|ws| ws.id), Some(b_id.clone()));
        // touch_used 落进了存储,而不是只改内存。
        assert!(store.get(&b_id).unwrap().unwrap().last_used_at.is_some());
    }

    #[test]
    fn remove_missing_is_not_found() {
        let (svc, _) = service();
        assert!(matches!(svc.remove("nope"), Err(WorkspaceError::NotFound)));
    }
}
