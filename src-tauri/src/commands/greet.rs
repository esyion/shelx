//! greet 冒烟 command:验证前端(Next.js)→ Tauri IPC → Rust 的完整链路,
//! 同时作为"薄 command + DTO + IpcResult 信封"的分层模板。

use crate::application;
use crate::dto::common::IpcResult;
use crate::dto::greet::{GreetRequest, GreetResponse};
use crate::shared::error::{IpcError, IpcErrorCode};

/// 名称最大长度(按字符计),防止异常超长输入进入业务层。
const MAX_NAME_LEN: usize = 64;

/// 冒烟 command:校验请求后委托应用层用例拼装问候语。
#[tauri::command]
pub fn greet(request: GreetRequest) -> IpcResult<GreetResponse> {
    let name = request.name.trim();
    if name.is_empty() {
        return IpcResult::err(IpcError::new(IpcErrorCode::InvalidArgument, "名称不能为空"));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return IpcResult::err(IpcError::new(
            IpcErrorCode::InvalidArgument,
            format!("名称最多 {MAX_NAME_LEN} 个字符"),
        ));
    }
    IpcResult::ok(GreetResponse {
        message: application::greet::greet(name),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_name_returns_greeting() {
        let response = greet(GreetRequest {
            name: " shelx ".into(),
        })
        .into_data()
        .expect("合法输入应成功");
        assert_eq!(
            response.message,
            "Hello, shelx! You've been greeted from Rust!"
        );
    }

    #[test]
    fn blank_name_is_rejected() {
        let error = greet(GreetRequest { name: "   ".into() })
            .into_err()
            .expect("空白输入应失败");
        assert_eq!(error.code, IpcErrorCode::InvalidArgument);
    }

    #[test]
    fn oversized_name_is_rejected() {
        let error = greet(GreetRequest {
            name: "字".repeat(MAX_NAME_LEN + 1),
        })
        .into_err()
        .expect("超长输入应失败");
        assert_eq!(error.code, IpcErrorCode::InvalidArgument);
    }
}
