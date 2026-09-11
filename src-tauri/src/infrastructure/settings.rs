//! 设置/布局的 JSON 文件持久化:配置目录下 settings.json 与 layout.json(设计文档 §7.1/§7.3)。
//!
//! 写入采用"临时文件 + rename"原子替换,避免半截写损坏配置。

use std::path::{Path, PathBuf};

use crate::application::ports::{SettingsStore, StoreError};

/// JSON 文件版设置存储。
pub struct JsonFileSettingsStore {
    settings_path: PathBuf,
    layout_path: PathBuf,
}

impl JsonFileSettingsStore {
    /// 以配置目录构建;文件路径固定为 `settings.json` / `layout.json`。
    pub fn open(config_dir: &Path) -> Self {
        Self {
            settings_path: config_dir.join("settings.json"),
            layout_path: config_dir.join("layout.json"),
        }
    }

    /// 读取 JSON 文件;不存在返回 `None`。
    fn read(path: &Path) -> Result<Option<String>, StoreError> {
        match std::fs::read_to_string(path) {
            Ok(raw) => Ok(Some(raw)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(StoreError(err.to_string())),
        }
    }

    /// 原子写入 JSON 文件(同目录临时文件 + rename)。
    fn write(path: &Path, raw: &str) -> Result<(), StoreError> {
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, raw).map_err(|e| StoreError(e.to_string()))?;
        std::fs::rename(&tmp, path).map_err(|e| StoreError(e.to_string()))
    }
}

impl SettingsStore for JsonFileSettingsStore {
    fn load_settings(&self) -> Result<Option<String>, StoreError> {
        Self::read(&self.settings_path)
    }

    fn save_settings(&self, raw: &str) -> Result<(), StoreError> {
        Self::write(&self.settings_path, raw)
    }

    fn load_layout(&self) -> Result<Option<String>, StoreError> {
        Self::read(&self.layout_path)
    }

    fn save_layout(&self, raw: &str) -> Result<(), StoreError> {
        Self::write(&self.layout_path, raw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 文件 round-trip:写入 → 读回一致;未写入的布局文件返回 None。
    #[test]
    fn file_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = JsonFileSettingsStore::open(dir.path());
        assert_eq!(store.load_settings().unwrap(), None);

        store
            .save_settings("{\"appearance\":{\"theme\":\"dark\"}}")
            .unwrap();
        assert!(store.load_settings().unwrap().unwrap().contains("dark"));
        assert_eq!(store.load_layout().unwrap(), None);

        store.save_layout("{\"sidebarWidth\":260}").unwrap();
        assert!(store.load_layout().unwrap().unwrap().contains("260"));
    }
}
