//! 设置 IPC DTO:直接复用应用层的 [`AppSettings`] 作为契约单一来源
//! (设置是纯数据形状,无内部实体可泄露;字段 camelCase 由应用层 serde 保证)。
//! 设置项的取值区间/候选值同样由应用层 schema 提供,界面不得再抄一份。

pub use crate::application::settings::schema::{SettingSpec, SettingViolation};
pub use crate::application::settings::AppSettings;
