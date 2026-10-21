//! rig 记忆存储适配器:把 `rig_memory::Store` 落到 shelx 的 SQLite(AGENTS.md §4.5)。
//!
//! 为什么自己实现而不是用 `DirStore`:本机数据统一走 SQLite 与 `~/.shelx` 一套约定
//! (AGENTS.md §10),不允许再长出第二套散落文件。
//!
//! 名称处理:这里的 `name` 只作为数据库主键的一段,永不拼成文件系统路径,
//! 因此不存在路径穿越面;并发按 rig 的长度前置条件实现(`store_conditional`),
//! 不匹配即 [`rig_memory::LogWriteError::Changed`],由 rig 自行收敛。

use std::io;
use std::sync::Arc;

use rig::memory::{Files, LogWriteError, Store};

use crate::application::agent::types::AgentStore;

/// 一个线程的记忆存储(命名空间 = 线程 ID)。
pub struct ThreadMemoryStore {
    store: Arc<dyn AgentStore>,
    space: String,
}

impl ThreadMemoryStore {
    /// 为某线程构造存储适配器。
    #[must_use]
    pub fn new(store: Arc<dyn AgentStore>, thread_id: &str) -> Self {
        Self {
            store,
            space: thread_id.to_owned(),
        }
    }

    /// 把存储端口错误转成 io 错误。
    fn io_fault(err: crate::application::agent::types::StoreFault) -> io::Error {
        io::Error::other(err.to_string())
    }

    /// 不存在 → `NotFound`(rig 以此判定"还没有这份日志")。
    fn not_found(name: &str) -> io::Error {
        io::Error::new(io::ErrorKind::NotFound, format!("记忆对象不存在:{name}"))
    }
}

impl Store for ThreadMemoryStore {
    fn logs(&self) -> io::Result<Vec<String>> {
        self.store
            .store_list(&self.space, "log")
            .map_err(Self::io_fault)
    }

    fn read_log(&self, name: &str) -> io::Result<Vec<u8>> {
        self.store
            .store_get(&self.space, name)
            .map_err(Self::io_fault)?
            .ok_or_else(|| Self::not_found(name))
    }

    fn append_log(&self, name: &str, len: u64, bytes: &[u8]) -> Result<(), LogWriteError> {
        let changed = self
            .store
            .store_conditional(&self.space, name, len as i64, bytes, true)
            .map_err(Self::io_fault)?;
        if changed {
            return Err(LogWriteError::Changed);
        }
        Ok(())
    }

    fn replace_log(&self, name: &str, len: u64, bytes: &[u8]) -> Result<(), LogWriteError> {
        let changed = self
            .store
            .store_conditional(&self.space, name, len as i64, bytes, false)
            .map_err(Self::io_fault)?;
        if changed {
            return Err(LogWriteError::Changed);
        }
        Ok(())
    }

    fn destroy(&self) -> io::Result<()> {
        // 只清本线程命名空间,绝不触碰其它对话或别的表(AGENTS.md §7 最小影响面)。
        self.store.store_clear(&self.space).map_err(Self::io_fault)
    }
}

impl Files for ThreadMemoryStore {
    fn write_file(&self, name: &str, bytes: &[u8]) -> io::Result<()> {
        self.store
            .store_put(&self.space, name, bytes)
            .map_err(Self::io_fault)
    }

    fn append_file(&self, name: &str, bytes: &[u8]) -> io::Result<()> {
        // 文件语义是无条件追加(长度前置条件只属于日志)。
        let existing = self.read_file(name).unwrap_or_default();
        let mut merged = existing;
        merged.extend_from_slice(bytes);
        self.store
            .store_put(&self.space, name, &merged)
            .map_err(Self::io_fault)
    }

    fn read_file(&self, name: &str) -> io::Result<Vec<u8>> {
        self.store
            .store_get(&self.space, name)
            .map_err(Self::io_fault)?
            .ok_or_else(|| Self::not_found(name))
    }

    fn remove_file(&self, name: &str) -> io::Result<()> {
        self.store
            .store_remove(&self.space, name)
            .map_err(Self::io_fault)
    }

    fn files(&self) -> io::Result<Vec<String>> {
        self.store
            .store_list(&self.space, "file")
            .map_err(Self::io_fault)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::agent::types::{
        AgentMemory, ApprovalRecord, AuditRecord, MessageRecord, ProfileRecord, RunRecord,
        StoreFault, ThreadRecord,
    };
    use crate::domain::agent::{MemoryId, MemoryScope};
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// (空间, 名称) → (类别, 内容)。
    type NodeMap = HashMap<(String, String), (String, Vec<u8>)>;

    /// 内存版存储端口(只实现适配器用到的命名空间方法)。
    #[derive(Default)]
    struct FakeStore {
        nodes: Mutex<NodeMap>,
    }

    impl FakeStore {
        /// 取对象。
        fn get(&self, space: &str, name: &str) -> Option<Vec<u8>> {
            self.nodes
                .lock()
                .unwrap()
                .get(&(space.to_owned(), name.to_owned()))
                .map(|(_, bytes)| bytes.clone())
        }
    }

    impl AgentStore for FakeStore {
        fn threads(&self) -> Result<Vec<ThreadRecord>, StoreFault> {
            Ok(Vec::new())
        }
        fn thread(&self, _id: &str) -> Result<Option<ThreadRecord>, StoreFault> {
            Ok(None)
        }
        fn upsert_thread(&self, _thread: &ThreadRecord) -> Result<(), StoreFault> {
            Ok(())
        }
        fn delete_thread(&self, _id: &str) -> Result<(), StoreFault> {
            Ok(())
        }
        fn append_message(&self, _message: &MessageRecord) -> Result<(), StoreFault> {
            Ok(())
        }
        fn messages(
            &self,
            _thread_id: &str,
            _limit: usize,
        ) -> Result<Vec<MessageRecord>, StoreFault> {
            Ok(Vec::new())
        }
        fn upsert_run(&self, _run: &RunRecord) -> Result<(), StoreFault> {
            Ok(())
        }
        fn runs(&self, _thread_id: &str) -> Result<Vec<RunRecord>, StoreFault> {
            Ok(Vec::new())
        }
        fn expire_unfinished_runs(&self) -> Result<usize, StoreFault> {
            Ok(0)
        }
        fn insert_tool_call(&self, _record: &AuditRecord) -> Result<(), StoreFault> {
            Ok(())
        }
        fn tool_calls(&self, _thread_id: &str) -> Result<Vec<AuditRecord>, StoreFault> {
            Ok(Vec::new())
        }
        fn record_approval(&self, _record: &ApprovalRecord) -> Result<(), StoreFault> {
            Ok(())
        }
        fn memories(&self) -> Result<Vec<AgentMemory>, StoreFault> {
            Ok(Vec::new())
        }
        fn upsert_memory(&self, _memory: &AgentMemory) -> Result<(), StoreFault> {
            Ok(())
        }
        fn delete_memory(&self, _id: &str) -> Result<(), StoreFault> {
            Ok(())
        }
        fn profiles(&self) -> Result<Vec<ProfileRecord>, StoreFault> {
            Ok(Vec::new())
        }
        fn upsert_profile(&self, _profile: &ProfileRecord) -> Result<(), StoreFault> {
            Ok(())
        }
        fn delete_profile(&self, _id: &str) -> Result<(), StoreFault> {
            Ok(())
        }
        fn store_put(&self, space: &str, name: &str, bytes: &[u8]) -> Result<(), StoreFault> {
            self.nodes.lock().unwrap().insert(
                (space.to_owned(), name.to_owned()),
                ("log".to_owned(), bytes.to_vec()),
            );
            Ok(())
        }
        fn store_get(&self, space: &str, name: &str) -> Result<Option<Vec<u8>>, StoreFault> {
            Ok(self.get(space, name))
        }
        fn store_conditional(
            &self,
            space: &str,
            name: &str,
            len: i64,
            bytes: &[u8],
            append: bool,
        ) -> Result<bool, StoreFault> {
            let mut nodes = self.nodes.lock().unwrap();
            let key = (space.to_owned(), name.to_owned());
            let current = nodes.get(&key).map(|(_, value)| value.clone());
            let current_len = current.as_ref().map_or(0, Vec::len) as i64;
            if current_len != len {
                return Ok(true);
            }
            let mut merged = if append {
                current.unwrap_or_default()
            } else {
                Vec::new()
            };
            merged.extend_from_slice(bytes);
            nodes.insert(key, ("log".to_owned(), merged));
            Ok(false)
        }
        fn store_list(&self, space: &str, _kind: &str) -> Result<Vec<String>, StoreFault> {
            Ok(self
                .nodes
                .lock()
                .unwrap()
                .iter()
                .filter(|((scope, _), _)| scope == space)
                .map(|((_, name), _)| name.clone())
                .collect())
        }
        fn store_remove(&self, space: &str, name: &str) -> Result<(), StoreFault> {
            self.nodes
                .lock()
                .unwrap()
                .remove(&(space.to_owned(), name.to_owned()));
            Ok(())
        }
        fn store_clear(&self, space: &str) -> Result<(), StoreFault> {
            self.nodes
                .lock()
                .unwrap()
                .retain(|(scope, _), _| scope != space);
            Ok(())
        }
    }

    /// 新建适配器。
    fn adapter() -> (Arc<FakeStore>, ThreadMemoryStore) {
        let store = Arc::new(FakeStore::default());
        let adapter = ThreadMemoryStore::new(Arc::clone(&store) as Arc<dyn AgentStore>, "t1");
        (store, adapter)
    }

    /// 空日志按 NotFound 上报(rig 以此判断"从头开始")。
    #[test]
    fn missing_log_is_not_found() {
        let (_store, adapter) = adapter();
        let err = adapter.read_log("t1").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
        assert!(adapter.logs().unwrap().is_empty());
    }

    /// 追加遵守长度前置条件,冲突时回报 Changed。
    #[test]
    fn append_respects_length_precondition() {
        let (store, adapter) = adapter();
        adapter.append_log("t1", 0, b"abc").unwrap();
        assert_eq!(adapter.read_log("t1").unwrap(), b"abc");
        // 用过期长度再追加必须失败且不写入。
        assert!(matches!(
            adapter.append_log("t1", 0, b"def"),
            Err(LogWriteError::Changed)
        ));
        assert_eq!(adapter.read_log("t1").unwrap(), b"abc");
        adapter.append_log("t1", 3, b"def").unwrap();
        assert_eq!(store.get("t1", "t1").unwrap(), b"abcdef");
    }

    /// 替换遵守同样的前置条件,并可整体改写。
    #[test]
    fn replace_swaps_whole_log() {
        let (_store, adapter) = adapter();
        adapter.append_log("t1", 0, b"old").unwrap();
        adapter.replace_log("t1", 3, b"new").unwrap();
        assert_eq!(adapter.read_log("t1").unwrap(), b"new");
        assert!(matches!(
            adapter.replace_log("t1", 99, b"x"),
            Err(LogWriteError::Changed)
        ));
    }

    /// 文件写入与列举按命名空间隔离。
    #[test]
    fn files_are_scoped_by_thread() {
        let (_store, adapter) = adapter();
        adapter.write_file("blobs/a", b"1").unwrap();
        adapter.append_file("blobs/a", b"2").unwrap();
        assert_eq!(adapter.read_file("blobs/a").unwrap(), b"12");
        assert_eq!(adapter.files().unwrap(), vec!["blobs/a".to_owned()]);
        adapter.remove_file("blobs/a").unwrap();
        assert!(adapter.files().unwrap().is_empty());
        assert_eq!(
            adapter.read_file("blobs/a").unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
    }

    /// destroy 只清本线程内容。
    #[test]
    fn destroy_clears_only_this_space() {
        let (store, adapter) = adapter();
        adapter.append_log("t1", 0, b"x").unwrap();
        store.store_put("t2", "t2", b"other").expect("写入另一线程");
        adapter.destroy().unwrap();
        assert!(adapter.logs().unwrap().is_empty());
        assert_eq!(store.get("t2", "t2").unwrap(), b"other");
    }

    /// 记忆领域对象仍可独立构造(适配器不依赖它,占位断言防误改)。
    #[test]
    fn memory_domain_still_validates() {
        assert!(AgentMemory::new(
            MemoryId::new("m").unwrap(),
            MemoryScope::Global,
            None,
            "x".into(),
            true
        )
        .is_ok());
    }
}
