//! 更新 IPC DTO:直接复用应用层的 [`UpdateNotice`] 作为契约单一来源
//! (事件载荷与 command 响应同形;字段 camelCase 由应用层 serde 保证)。

pub use crate::application::update::UpdateNotice;
