//! 应用数据目录解析与一次性目录迁移(AGENTS.md §10、设计文档 §7.1)。
//!
//! 本机数据统一存放于 `~/.shelx`;历史版本曾使用 `~/.agents-plus/shelx`。
//! 目录选择遵循"任意时刻只写一个目录"不变式:
//! 新目录非空 → 用新目录(旧目录冻结为只读备份,永不合并);
//! 否则旧目录非空 → 用旧目录跑(数据连续性优先),等待用户批准迁移;
//! 否则 → 新目录(全新安装或已迁移)。
//! 真正的切换是"批准 → 重启 → 启动早期原子 rename",因为 rename 必须发生在
//! SQLite/日志等任何句柄打开之前;运行中迁移在 Windows 上会因文件占用失败。
//! 禁止硬编码绝对路径。

use std::io;
use std::path::{Path, PathBuf};

/// 主目录下的 shelx 数据目录名。
pub const DATA_DIR_NAME: &str = ".shelx";
/// 历史版本的数据父目录名(`~/.agents-plus/shelx`,与 cc-switch 生态共享父目录)。
pub const LEGACY_PARENT_DIR: &str = ".agents-plus";
/// 历史版本的数据目录名。
pub const LEGACY_DATA_DIR_NAME: &str = "shelx";

/// 当前运行使用的数据目录来源。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataDirSource {
    /// 标准新位置(`~/.shelx`)。
    Default,
    /// 历史位置(`~/.agents-plus/shelx`);用户点「暂不」后长期处于此状态。
    Legacy,
}

/// 数据目录解析结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataDirResolution {
    /// 本进程实际使用的数据目录;调用后确保存在。
    pub dir: PathBuf,
    /// 数据目录的标准新位置(迁移目标;`source` 为 Default 时与 `dir` 相同)。
    pub default_dir: PathBuf,
    /// 目录来源(决定迁移弹窗与设置页入口是否可见)。
    pub source: DataDirSource,
}

/// 目录迁移执行结果;失败时已自动回退旧目录,数据不受影响。
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub enum MigrationOutcome {
    /// 未请求迁移或无迁移条件(全新安装/新目录已有数据)。
    #[default]
    NotAttempted,
    /// rename 成功,本进程使用新目录。
    Applied,
    /// rename 失败;已回退旧目录,标记保留待下次启动重试。
    Failed(String),
}

/// 迁移旧数据目录到新位置,返回解析结果与迁移执行结果。
///
/// `attempt_migration` 为 true 且条件满足(新目录空、旧目录非空)时,
/// 先执行"旧目录整体 rename 到新位置"(同卷原子操作,零拷贝),成功后
/// 尝试清理空的旧父目录;失败则回退用旧目录继续运行,绝不阻塞启动。
///
/// # Errors
/// - 用户主目录无法解析(极少见的剥离环境);
/// - 目录创建失败(磁盘只读、权限不足)。
pub fn resolve_data_dir(
    attempt_migration: bool,
) -> io::Result<(DataDirResolution, MigrationOutcome)> {
    let home = dirs::home_dir().ok_or_else(|| io::Error::other("无法解析用户主目录"))?;
    resolve_data_dir_at(&home, attempt_migration)
}

/// [`resolve_data_dir`](fn@resolve_data_dir) 的提参核心,`home` 可注入以便测试。
pub fn resolve_data_dir_at(
    home: &Path,
    attempt_migration: bool,
) -> io::Result<(DataDirResolution, MigrationOutcome)> {
    let new_dir = home.join(DATA_DIR_NAME);
    let legacy_dir = home.join(LEGACY_PARENT_DIR).join(LEGACY_DATA_DIR_NAME);

    // 新目录已有数据 → 用新目录,旧目录冻结,永不触碰(防止覆盖用户重新开始的数据)。
    if dir_has_content(&new_dir) {
        create_dir_all_verified(&new_dir)?;
        return Ok((
            resolution(new_dir.clone(), new_dir, DataDirSource::Default),
            MigrationOutcome::NotAttempted,
        ));
    }

    let legacy_present = dir_has_content(&legacy_dir);

    // 用户已批准迁移 → 启动早期原子 rename(此刻无任何句柄打开)。
    if attempt_migration && legacy_present {
        match std::fs::rename(&legacy_dir, &new_dir) {
            Ok(()) => {
                // 只清理自己名下的空父目录;cc-switch 等可能共用,绝不能递归删。
                let _ = std::fs::remove_dir(home.join(LEGACY_PARENT_DIR));
                create_dir_all_verified(&new_dir)?;
                return Ok((
                    resolution(new_dir.clone(), new_dir, DataDirSource::Default),
                    MigrationOutcome::Applied,
                ));
            }
            // 失败回退:本次继续用旧目录,标记保留,下次启动自然重试。
            Err(err) => {
                create_dir_all_verified(&legacy_dir)?;
                return Ok((
                    resolution(legacy_dir, new_dir, DataDirSource::Legacy),
                    MigrationOutcome::Failed(err.to_string()),
                ));
            }
        }
    }

    if legacy_present {
        create_dir_all_verified(&legacy_dir)?;
        return Ok((
            resolution(legacy_dir, new_dir, DataDirSource::Legacy),
            MigrationOutcome::NotAttempted,
        ));
    }

    create_dir_all_verified(&new_dir)?;
    Ok((
        resolution(new_dir.clone(), new_dir, DataDirSource::Default),
        MigrationOutcome::NotAttempted,
    ))
}

/// 构造解析结果。
fn resolution(dir: PathBuf, default_dir: PathBuf, source: DataDirSource) -> DataDirResolution {
    DataDirResolution {
        dir,
        default_dir,
        source,
    }
}

/// 当前安装的历史数据目录路径(仅作提示与迁移源展示,不保证存在)。
pub fn legacy_data_dir(home: &Path) -> PathBuf {
    home.join(LEGACY_PARENT_DIR).join(LEGACY_DATA_DIR_NAME)
}

/// 目录存在且含任何条目。
fn dir_has_content(dir: &Path) -> bool {
    std::fs::read_dir(dir).is_ok_and(|mut entries| entries.next().is_some())
}

/// 确保目录存在;`create_dir_all` 对已存在目录幂等。
fn create_dir_all_verified(dir: &Path) -> io::Result<()> {
    std::fs::create_dir_all(dir)?;
    Ok(())
}
