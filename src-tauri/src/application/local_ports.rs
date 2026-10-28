//! 本机能力端口:工作区受控文件系统(`WorkspaceFs`)。
//!
//! 与 `ports.rs` 分文件的原因:该文件已接近单文件行数约束(AGENTS.md §2),
//! 本机执行端口(`LocalExec`)后续也落在这里,保持本机能力一处聚齐。
//! 所有方法内部必须完成 confinement(词法归一 + canonicalize 复核),
//! 越界路径一律按错误返回 —— 端口实现是 confinement 的唯一执行点。

/// 工作区目录条目(名称、类型、大小与修改时间;时间与大小缺失时为 `None`,不伪造)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceListing {
    /// 条目名(不含路径)。
    pub name: String,
    /// 是否目录。
    pub is_dir: bool,
    /// 字节大小(目录或不可得时为 `None`)。
    pub size: Option<u64>,
    /// 修改时间(unix 毫秒;不可得时为 `None`)。
    pub mtime: Option<u64>,
}

/// 工作区受控文件系统端口(实现见 `infrastructure/workspace_fs.rs`)。
///
/// 同步语义与 `LocalFs` 一致(本地磁盘微秒级);`root` 参数总是**已 canonicalize**
/// 的工作区根(由 [`WorkspaceFs::resolve_root`] 产生并落库)。
pub trait WorkspaceFs: Send + Sync {
    /// 登记工作区时解析根路径:必须存在且是目录;返回 canonical 形态。
    ///
    /// # Errors
    /// 路径不存在、不是目录或系统错误(消息面向用户,不含内部细节)。
    fn resolve_root(&self, raw: &str) -> Result<String, String>;

    /// 读文本文件(≤`max_bytes` 字节,超出截断;返回内容与是否截断;非 UTF-8 有损转换)。
    ///
    /// # Errors
    /// 路径越界、不存在、是目录或读取失败。
    fn read_text(&self, root: &str, path: &str, max_bytes: u64) -> Result<(String, bool), String>;

    /// 列目录条目(按名称排序;`path` 缺省语义由调用方传 `""`/`.` 实现,落在根)。
    ///
    /// # Errors
    /// 路径越界、不存在或不是目录。
    fn list(&self, root: &str, path: &str) -> Result<Vec<WorkspaceListing>, String>;

    /// 写入文本(覆盖或追加;父目录不存在时创建;返回写入字节数)。
    ///
    /// # Errors
    /// 路径越界、目标是目录、磁盘满或写入失败。
    fn write(&self, root: &str, path: &str, content: &str, append: bool) -> Result<u64, String>;

    /// 删除**单文件或空目录**(不递归;递归删除必须由上层显式逐个发起)。
    ///
    /// # Errors
    /// 路径越界、不存在或删除失败。
    fn remove(&self, root: &str, path: &str) -> Result<(), String>;

    /// 重命名/移动(新旧路径都必须落在工作区内)。
    ///
    /// # Errors
    /// 任一路径越界、目标已存在或重命名失败。
    fn rename(&self, root: &str, old_path: &str, new_path: &str) -> Result<(), String>;
}
