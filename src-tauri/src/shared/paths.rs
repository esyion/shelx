//! 应用数据目录解析(AGENTS.md §10、设计文档 §7.1)。
//!
//! 本机数据统一存放于 `~/.agents-plus/shelx`(与 cc-switch 生态对齐的主目录约定):
//! SQLite、日志、降级加密凭据均落在该目录下;禁止硬编码绝对路径。

use std::io;
use std::path::PathBuf;

/// `~/.agents-plus` 下的 shelx 数据目录名。
const DATA_DIR_NAME: &str = "shelx";

/// 返回 shelx 本机数据目录(`~/.agents-plus/shelx`),不存在时逐级创建。
///
/// # Errors
/// - 用户主目录无法解析(极少见的剥离环境);
/// - 目录创建失败(磁盘只读、权限不足)。
pub fn data_dir() -> io::Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| io::Error::other("无法解析用户主目录"))?;
    let dir = home.join(".agents-plus").join(DATA_DIR_NAME);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 数据目录必须落在 ~/.agents-plus/shelx,且调用后确保存在。
    #[test]
    fn data_dir_lives_under_agents_plus() {
        let dir = data_dir().expect("数据目录应可解析");
        assert!(dir.ends_with(".agents-plus/shelx") || dir.ends_with(r".agents-plus\shelx"));
        assert!(dir.is_dir(), "调用后目录应已创建");
    }
}
