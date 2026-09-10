//! 所有 Tauri command 的统一响应信封,与前端 `IpcResult<T>` 判别联合对齐:
//! `{"ok": true, "data": ...}` 或 `{"ok": false, "error": {...}}`。

use serde::{ser::SerializeMap, Serialize, Serializer};
use std::fmt;

use crate::shared::error::IpcError;

/// command 成功/失败的统一信封(AGENTS.md §5 推荐结构)。
#[derive(Debug)]
pub enum IpcResult<T> {
    /// 成功载荷。
    Ok(T),
    /// 结构化失败。
    Err(IpcError),
}

impl<T> IpcResult<T> {
    /// 包装成功数据。
    pub fn ok(data: T) -> Self {
        Self::Ok(data)
    }

    /// 包装失败错误。
    pub fn err(error: IpcError) -> Self {
        Self::Err(error)
    }

    /// 消费信封取成功数据;失败返回 None(主要供测试断言)。
    pub fn into_data(self) -> Option<T> {
        match self {
            Self::Ok(data) => Some(data),
            Self::Err(_) => None,
        }
    }

    /// 消费信封取错误;成功返回 None(主要供测试断言)。
    pub fn into_err(self) -> Option<IpcError> {
        match self {
            Self::Ok(_) => None,
            Self::Err(error) => Some(error),
        }
    }
}

impl<T: Serialize> Serialize for IpcResult<T> {
    /// 手工序列化为判别联合:`ok` 为 JSON 布尔而非字符串 tag,
    /// 因此不能使用 serde 的 internally-tagged enum。
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(2))?;
        match self {
            Self::Ok(data) => {
                map.serialize_entry("ok", &true)?;
                map.serialize_entry("data", data)?;
            }
            Self::Err(error) => {
                map.serialize_entry("ok", &false)?;
                map.serialize_entry("error", error)?;
            }
        }
        map.end()
    }
}

impl<T: fmt::Display> fmt::Display for IpcResult<T> {
    /// 仅供日志与测试输出的可读表示,不参与 IPC 传输。
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Ok(data) => write!(f, "IpcResult::Ok({data})"),
            Self::Err(error) => write!(f, "IpcResult::Err({error:?})"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::error::IpcErrorCode;
    use serde_json::json;

    /// 成功信封序列化为 {"ok":true,"data":...}。
    #[test]
    fn ok_envelope_serializes_as_discriminated_union() {
        let value = serde_json::to_value(IpcResult::ok(json!({ "message": "hi" }))).unwrap();
        assert_eq!(value["ok"], json!(true));
        assert_eq!(value["data"]["message"], "hi");
    }

    /// 失败信封序列化为 {"ok":false,"error":{code,message}}。
    #[test]
    fn err_envelope_serializes_as_discriminated_union() {
        let value = serde_json::to_value(IpcResult::<()>::err(IpcError::new(
            IpcErrorCode::InvalidArgument,
            "名称不能为空",
        )))
        .unwrap();
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["error"]["code"], "INVALID_ARGUMENT");
    }
}
