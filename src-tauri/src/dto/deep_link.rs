//! 深链 DTO:ssh:// 协议拉起时解析出的目标(deep-link-connect 事件载荷)。

use serde::Serialize;

/// ssh:// 链接解析结果(`deep-link-connect` 事件载荷,用于预填快速连接)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeepLinkTargetDto {
    /// 主机(IP 或域名);必然非空(解析失败不发事件)。
    pub host: String,
    /// 用户名;链接未提供时为 None(前端沿用表单默认值)。
    pub username: Option<String>,
    /// 端口;链接未提供时为 22。
    pub port: u16,
}
