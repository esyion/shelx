//! greet 冒烟用例:演示 command → application 的调用分层。
//! 真实业务用例(连接管理、会话、SFTP、监控)随里程碑 M1+ 落地。

/// 拼装问候语。
///
/// @param name 已经过 command 层边界校验的名称(非空、长度受限)
/// @returns 返回给前端的问候语
pub fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greets_by_name() {
        assert_eq!(
            greet("shelx"),
            "Hello, shelx! You've been greeted from Rust!"
        );
    }
}
