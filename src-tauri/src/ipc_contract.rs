//! IPC 契约导出用例:把 Rust 边界类型编译成 JSON Schema 文档
//! `src-tauri/contract/ipc-schema.json`,前端据此生成 TS 类型(AGENTS.md §5)。
//!
//! 运行方式:
//! - 重新导出:`bun run gen:ipc`(内部执行 `SHELX_UPDATE_CONTRACT=1 cargo test --lib ipc_contract`)
//! - 日常门禁:`cargo test --lib` 与 `bun run check:ipc` 都会校验工件没过期。
//!
//! 契约里出现过的真实事故:前端手写镜像 `chunkSizeKiB`,后端 serde 实际产出
//! `chunkSizeKib` → 读为 undefined、写被静默丢弃。类型由本文件导出后,
//! 这类漂移在编译期与门禁里都不可能再发生。

use schemars::generate::{SchemaGenerator, SchemaSettings};
use serde_json::{json, Map, Value};

/// 单个类型的导出函数(返回指向 `$defs` 的引用)。
type ExportFn = fn(&mut SchemaGenerator) -> Value;

/// 导出一个类型的根引用。
fn refer<T: schemars::JsonSchema + ?Sized>(generator: &mut SchemaGenerator) -> Value {
    serde_json::to_value(generator.subschema_for::<T>()).expect("schema 必须可序列化")
}

/// 构建一个模块的自包含 schema(properties = 导出类型名,$defs = 具体定义)。
fn build_module(types: &[(&str, ExportFn)]) -> Value {
    let mut generator = SchemaSettings::draft2020_12()
        .for_serialize()
        .into_generator();
    let mut properties = Map::new();
    let mut required: Vec<Value> = Vec::new();
    for (name, export) in types {
        properties.insert((*name).to_owned(), export(&mut generator));
        required.push(json!(name));
    }
    let definitions = generator.take_definitions(true);
    json!({
        "type": "object",
        "properties": Value::Object(properties),
        "required": required,
        "additionalProperties": false,
        "$defs": Value::Object(definitions),
    })
}

/// 递归按字典序重排 JSON 对象键。
///
/// 为什么要显式排序:schemars 产出的 `$defs` / `properties` 来自哈希表,插入顺序
/// 随进程变化;不排序时同一份 Rust 代码每次 `bun run gen:ipc` 都会重排生成物字段,
/// 让 `bun run check:ipc` 在契约未变时也可能偶红(AGENTS.md §5 契约单点必须可复现)。
fn sort_keys(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> = map
                .into_iter()
                .map(|(key, child)| (key, sort_keys(child)))
                .collect();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            Value::Object(entries.into_iter().collect())
        }
        Value::Array(items) => Value::Array(items.into_iter().map(sort_keys).collect()),
        other => other,
    }
}

/// 完整契约文档(版本号用于识别占位与结构升级)。
fn document() -> Value {
    sort_keys(document_uncanonical())
}

/// 未排序的契约文档(仅供 [`document`] 调用)。
fn document_uncanonical() -> Value {
    json!({
        "version": 1,
        "modules": {
            "ipc": build_module(&[
                ("IpcErrorCode", refer::<crate::shared::error::IpcErrorCode>),
                ("IpcError", refer::<crate::shared::error::IpcError>),
            ]),
            "appMeta": build_module(&[
                ("AppVersionDto", refer::<crate::dto::app_meta::AppVersionDto>),
            ]),
            "connection": build_module(&[
                ("AuthMethodDto", refer::<crate::dto::connection::AuthMethodDto>),
                ("EncodingDto", refer::<crate::dto::connection::EncodingDto>),
                ("SecretSaveModeDto", refer::<crate::dto::connection::SecretSaveModeDto>),
                ("DeleteGroupModeDto", refer::<crate::dto::connection::DeleteGroupModeDto>),
                ("CredentialInputDto", refer::<crate::dto::connection::CredentialInputDto>),
                ("ConnectionDto", refer::<crate::dto::connection::ConnectionDto>),
                ("GroupDto", refer::<crate::dto::connection::GroupDto>),
                ("ConnectionNodeDto", refer::<crate::dto::connection::ConnectionNodeDto>),
                ("ConnectionInputDto", refer::<crate::dto::connection::ConnectionInputDto>),
                ("UpdateConnectionRequestDto", refer::<crate::dto::connection::UpdateConnectionRequestDto>),
                ("IdRequestDto", refer::<crate::dto::connection::IdRequestDto>),
                ("MoveConnectionRequestDto", refer::<crate::dto::connection::MoveConnectionRequestDto>),
                ("CreateGroupRequestDto", refer::<crate::dto::connection::CreateGroupRequestDto>),
                ("RenameGroupRequestDto", refer::<crate::dto::connection::RenameGroupRequestDto>),
                ("DeleteGroupRequestDto", refer::<crate::dto::connection::DeleteGroupRequestDto>),
                ("MoveGroupRequestDto", refer::<crate::dto::connection::MoveGroupRequestDto>),
            ]),
            "session": build_module(&[
                ("ServerInfoDto", refer::<crate::dto::session::ServerInfoDto>),
                ("SessionInfoDto", refer::<crate::dto::session::SessionInfoDto>),
                ("ConnectSessionRequestDto", refer::<crate::dto::session::ConnectSessionRequestDto>),
                ("QuickConnectRequestDto", refer::<crate::dto::session::QuickConnectRequestDto>),
                ("RespondAuthPromptRequestDto", refer::<crate::dto::session::RespondAuthPromptRequestDto>),
                ("RespondHostkeyConfirmRequestDto", refer::<crate::dto::session::RespondHostkeyConfirmRequestDto>),
                ("SessionStatusEvent", refer::<crate::application::ports::SessionStatusEvent>),
                ("PromptSpec", refer::<crate::application::ports::PromptSpec>),
                ("AuthPromptRequest", refer::<crate::application::ports::AuthPromptRequest>),
                ("HostKeyConfirmRequest", refer::<crate::application::ports::HostKeyConfirmRequest>),
            ]),
            "sftp": build_module(&[
                ("RemoteFileTypeDto", refer::<crate::dto::sftp::RemoteFileTypeDto>),
                ("FileEntryDto", refer::<crate::dto::sftp::FileEntryDto>),
                ("DeleteFailureDto", refer::<crate::dto::sftp::DeleteFailureDto>),
                ("DeleteRemoteResultDto", refer::<crate::dto::sftp::DeleteRemoteResultDto>),
                ("SessionPathRequestDto", refer::<crate::dto::sftp::SessionPathRequestDto>),
                ("SessionOnlyRequestDto", refer::<crate::dto::sftp::SessionOnlyRequestDto>),
                ("RenameRemoteEntryRequestDto", refer::<crate::dto::sftp::RenameRemoteEntryRequestDto>),
                ("SetRemotePermissionsRequestDto", refer::<crate::dto::sftp::SetRemotePermissionsRequestDto>),
                ("DeleteRemoteEntriesRequestDto", refer::<crate::dto::sftp::DeleteRemoteEntriesRequestDto>),
            ]),
            "terminal": build_module(&[
                ("TerminalHandleDto", refer::<crate::dto::terminal::TerminalHandleDto>),
                ("OpenTerminalRequestDto", refer::<crate::dto::terminal::OpenTerminalRequestDto>),
                ("WriteTerminalRequestDto", refer::<crate::dto::terminal::WriteTerminalRequestDto>),
                ("ResizeTerminalRequestDto", refer::<crate::dto::terminal::ResizeTerminalRequestDto>),
            ]),
            "transfer": build_module(&[
                ("ConflictPolicyDto", refer::<crate::dto::transfer::ConflictPolicyDto>),
                ("ConflictDecisionDto", refer::<crate::dto::transfer::ConflictDecisionDto>),
                ("TransferDirection", refer::<crate::application::ports::TransferDirection>),
                ("TransferStatus", refer::<crate::domain::transfer::TransferStatus>),
                ("SessionStatus", refer::<crate::domain::session::SessionStatus>),
                ("TransferTaskDto", refer::<crate::dto::transfer::TransferTaskDto>),
                ("EnqueueResultDto", refer::<crate::dto::transfer::EnqueueResultDto>),
                ("EnqueueUploadRequestDto", refer::<crate::dto::transfer::EnqueueUploadRequestDto>),
                ("EnqueueDownloadRequestDto", refer::<crate::dto::transfer::EnqueueDownloadRequestDto>),
                ("RespondConflictRequestDto", refer::<crate::dto::transfer::RespondConflictRequestDto>),
                ("ClearTransfersRequestDto", refer::<crate::dto::transfer::ClearTransfersRequestDto>),
                ("TransferProgressEvent", refer::<crate::application::ports::TransferProgressEvent>),
            ]),
            "monitor": build_module(&[
                ("MetricsSampleDto", refer::<crate::dto::monitor::MetricsSampleDto>),
                ("DiskInfoDto", refer::<crate::dto::monitor::DiskInfoDto>),
                ("ProcessInfoDto", refer::<crate::dto::monitor::ProcessInfoDto>),
            ]),
            "migration": build_module(&[
                ("DataDirSourceDto", refer::<crate::dto::migration::DataDirSourceDto>),
                ("DataMigrationItem", refer::<crate::dto::migration::DataMigrationItem>),
                ("DataMigration", refer::<crate::dto::migration::DataMigration>),
                ("DataMigrationStatus", refer::<crate::dto::migration::DataMigrationStatus>),
            ]),
            "settings": build_module(&[
                ("AppSettings", refer::<crate::dto::settings::AppSettings>),
                ("SettingSpec", refer::<crate::dto::settings::SettingSpec>),
                ("SettingViolation", refer::<crate::dto::settings::SettingViolation>),
            ]),
            "update": build_module(&[
                ("UpdateNotice", refer::<crate::dto::update::UpdateNotice>),
            ]),
            "agent": build_module(&[
                ("ProtocolKind", refer::<crate::domain::agent::ProtocolKind>),
                ("ApprovalMode", refer::<crate::domain::agent::ApprovalMode>),
                ("ApprovalDecision", refer::<crate::domain::agent::ApprovalDecision>),
                ("RunState", refer::<crate::domain::agent::RunState>),
                ("TargetStatus", refer::<crate::domain::agent::TargetStatus>),
                ("ToolCategory", refer::<crate::domain::agent::ToolCategory>),
                ("MemoryScope", refer::<crate::domain::agent::MemoryScope>),
                ("TargetScope", refer::<crate::domain::agent::TargetScope>),
                ("MessageRole", refer::<crate::application::agent::types::MessageRole>),
                ("AgentEventKind", refer::<crate::application::agent::events::AgentEventKind>),
                ("AgentUsage", refer::<crate::application::agent::events::AgentUsage>),
                ("AgentEvent", refer::<crate::application::agent::events::AgentEvent>),
                ("ThreadDto", refer::<crate::dto::agent::ThreadDto>),
                ("MessageDto", refer::<crate::dto::agent::MessageDto>),
                ("RunDto", refer::<crate::dto::agent::RunDto>),
                ("AuditDto", refer::<crate::dto::agent::AuditDto>),
                ("TargetDto", refer::<crate::dto::agent::TargetDto>),
                ("ApprovalDto", refer::<crate::dto::agent::ApprovalDto>),
                ("ThreadSnapshotDto", refer::<crate::dto::agent::ThreadSnapshotDto>),
                ("ProfileDto", refer::<crate::dto::agent::ProfileDto>),
                ("MemoryDto", refer::<crate::dto::agent::MemoryDto>),
                ("SendAcceptedDto", refer::<crate::dto::agent::SendAcceptedDto>),
                ("ProbeDto", refer::<crate::dto::agent::ProbeDto>),
                ("CreateThreadRequestDto", refer::<crate::dto::agent::CreateThreadRequestDto>),
                ("UpdateThreadRequestDto", refer::<crate::dto::agent::UpdateThreadRequestDto>),
                ("SendMessageRequestDto", refer::<crate::dto::agent::SendMessageRequestDto>),
                ("ThreadIdRequestDto", refer::<crate::dto::agent::ThreadIdRequestDto>),
                ("CancelRunRequestDto", refer::<crate::dto::agent::CancelRunRequestDto>),
                ("ApprovalDecisionDto", refer::<crate::dto::agent::ApprovalDecisionDto>),
                ("RespondApprovalRequestDto", refer::<crate::dto::agent::RespondApprovalRequestDto>),
                ("DetachRequestDto", refer::<crate::dto::agent::DetachRequestDto>),
                ("UpsertProfileRequestDto", refer::<crate::dto::agent::UpsertProfileRequestDto>),
                ("AgentIdRequestDto", refer::<crate::dto::agent::AgentIdRequestDto>),
                ("UpsertMemoryRequestDto", refer::<crate::dto::agent::UpsertMemoryRequestDto>),
                ("ResolveTargetsRequestDto", refer::<crate::dto::agent::ResolveTargetsRequestDto>),
            ]),
        }
    })
}

/// 契约文件路径(仓库内,`build.rs` 与前端 codegen 共用同一份)。
fn contract_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("contract")
        .join("ipc-schema.json")
}

/// 导出模式写文件;校验模式断言未过期(改类型忘了重生成时门禁先红)。
#[test]
fn ipc_schema_document_is_up_to_date() {
    let doc = document();
    let path = contract_path();
    if std::env::var("SHELX_UPDATE_CONTRACT").is_ok() {
        std::fs::create_dir_all(path.parent().unwrap()).expect("创建 contract 目录失败");
        std::fs::write(
            &path,
            format!("{}\n", serde_json::to_string_pretty(&doc).unwrap()),
        )
        .expect("写入契约文档失败");
        return;
    }
    let on_disk = std::fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "缺少 IPC 契约文档 {},请运行 SHELX_UPDATE_CONTRACT=1 cargo test --test ipc_schema 后 bun run gen:ipc",
            path.display()
        )
    });
    let parsed: Value = serde_json::from_str(&on_disk).expect("契约文档必须是合法 JSON");
    assert_eq!(
        parsed, doc,
        "IPC 契约文档已过期,请重新导出后 bun run gen:ipc"
    );
}

/// 遍历 schema 中所有属性名,便于机器校验跨边界约束。
fn walk_properties(value: &Value, visit: &mut impl FnMut(&str, &Value)) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if key == "properties" {
                    if let Some(props) = child.as_object() {
                        for (name, schema) in props {
                            visit(name, schema);
                        }
                    }
                }
                walk_properties(child, visit);
            }
        }
        Value::Array(items) => {
            for item in items {
                walk_properties(item, visit);
            }
        }
        _ => {}
    }
}

/// 判断某属性 schema 是否允许 string(含 `type: ["string","null"]` 与 anyOf 形态)。
fn allows_string(schema: &Value) -> bool {
    match schema.get("type") {
        Some(Value::String(kind)) => return kind == "string",
        // Option<T> 导出为 type 数组,含 string 即可。
        Some(Value::Array(kinds)) if kinds.iter().any(|kind| kind.as_str() == Some("string")) => {
            return true;
        }
        _ => {}
    }
    if let Some(any_of) = schema.get("anyOf").and_then(Value::as_array) {
        return any_of.iter().any(allows_string);
    }
    if let Some(one_of) = schema.get("oneOf").and_then(Value::as_array) {
        return one_of.iter().any(allows_string);
    }
    // 引用形态:定义在同一文档的 $defs 里,由枚举/嵌套类型的专项断言覆盖。
    schema.get("$ref").is_some()
}

/// AGENTS.md §5 硬约束:所有 `*Id` 字段必须是 string,禁止数字 ID 跨边界。
#[test]
fn every_id_field_is_string_typed() {
    let doc = document();
    let mut offenders: Vec<String> = Vec::new();
    for module in doc["modules"]
        .as_object()
        .expect("modules 必须是对象")
        .values()
    {
        walk_properties(module, &mut |name, schema| {
            let is_id = name == "id" || (name.ends_with("Id") && name.len() > 2);
            if is_id && !allows_string(schema) {
                offenders.push(format!("{name} => {}", schema));
            }
        });
    }
    assert!(
        offenders.is_empty(),
        "以下 ID 字段不是 string 类型(AGENTS.md §5):{offenders:?}"
    );
}

/// 枚举化后线上字面量必须保持不变(前端与已落库的字符串按这些值比对)。
#[test]
fn enum_wire_literals_are_unchanged() {
    use crate::domain::session::SessionStatus;
    use crate::domain::transfer::TransferStatus;

    let status = serde_json::to_value(SessionStatus::Disconnected).unwrap();
    assert_eq!(status, json!("disconnected"));
    for (value, expected) in [
        (SessionStatus::Connecting, "connecting"),
        (SessionStatus::Online, "online"),
        (SessionStatus::Disconnected, "disconnected"),
    ] {
        assert_eq!(serde_json::to_value(value).unwrap(), json!(expected));
        assert_eq!(serde_json::to_value(value).unwrap(), json!(value.as_str()));
    }
    for (value, expected) in [
        (TransferStatus::Queued, "queued"),
        (TransferStatus::Preparing, "preparing"),
        (TransferStatus::AwaitingConflict, "awaiting_conflict"),
        (TransferStatus::Transferring, "transferring"),
        (TransferStatus::Completed, "completed"),
        (TransferStatus::Failed, "failed"),
        (TransferStatus::Cancelled, "cancelled"),
    ] {
        assert_eq!(serde_json::to_value(value).unwrap(), json!(expected));
        assert_eq!(serde_json::to_value(value).unwrap(), json!(value.as_str()));
    }
}

/// 契约文档必须按键有序:哈希表顺序一旦泄漏进工件,`check:ipc` 会在契约未变时偶发红。
#[test]
fn contract_document_keys_are_sorted() {
    fn walk(value: &Value) {
        match value {
            Value::Object(map) => {
                let keys: Vec<&String> = map.keys().collect();
                let mut sorted = keys.clone();
                sorted.sort();
                assert_eq!(keys, sorted, "契约工件的键必须按字典序落盘");
                for child in map.values() {
                    walk(child);
                }
            }
            Value::Array(items) => items.iter().for_each(walk),
            _ => {}
        }
    }
    walk(&document());
}

/// 每个模块必须真的导出至少一个类型,防止登记漏项。
#[test]
fn every_module_exports_types() {
    let doc = document();
    let modules = doc["modules"].as_object().expect("modules 必须是对象");
    assert!(!modules.is_empty(), "契约文档必须包含模块");
    for (name, module) in modules {
        let count = module["properties"]
            .as_object()
            .map(|props| props.len())
            .unwrap_or(0);
        assert!(count > 0, "模块 {name} 没有导出任何类型");
        assert!(
            module
                .get("$defs")
                .and_then(Value::as_object)
                .is_some_and(|defs| !defs.is_empty()),
            "模块 {name} 缺少类型定义"
        );
    }
}
