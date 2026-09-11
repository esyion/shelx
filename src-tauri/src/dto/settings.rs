//! 设置 IPC DTO:直接复用应用层的 [`AppSettings`] 作为契约单一来源
//! (设置是纯数据形状,无内部实体可泄露;字段 camelCase 由应用层 serde 保证)。

pub use crate::application::settings::AppSettings;
