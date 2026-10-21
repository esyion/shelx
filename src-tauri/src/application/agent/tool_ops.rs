//! 工具的单台主机落地动作与不针对主机的工具(AGENTS.md §4.5 只做适配,不做业务判断)。
//!
//! 类别判定与批准在 [`super::tool_host`],这里只负责"在已批准的机器上把事做完并如实回报"。
//! 每个远端动作都收敛到 [`dispatch_tool`]:返回 `Result<String, String>`,
//! 由 [`run_on_target`] 统一转成逐台结果,避免各处 `?` 与状态机混在一起。

use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;

use super::tool_host::{excerpt, int_field, string_field};
use super::tools::{ToolOutcome, ToolTargetOutcome};
use super::types::{AgentStore, RunContext};
use crate::application::connections::ConnectionService;
use crate::application::sessions::SessionService;
use crate::application::sftp::SftpService;
use crate::domain::agent::command_policy::{
    check_read_path, check_write_path, quote_argv, MAX_READ_BYTES,
};
use crate::domain::agent::{AgentMemory, MemoryId, MemoryScope, TargetStatus};
use crate::domain::connection::ConnId;
use crate::domain::session::SessionStatus;

/// 列出用户配置过的服务器(全部,含离线)。
pub(crate) fn list_connections(
    connections: &ConnectionService,
    sessions: &SessionService,
    arguments: &Value,
) -> ToolOutcome {
    let only_online = arguments
        .get("onlyOnline")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let online: Vec<String> = sessions
        .list()
        .into_iter()
        .filter(|info| info.status == SessionStatus::Online)
        .filter_map(|info| info.conn_id)
        .collect();
    match connections.all_connections() {
        Ok(configured) => {
            let items: Vec<Value> = configured
                .iter()
                .filter(|config| !only_online || online.iter().any(|id| id == config.id.as_str()))
                .map(|config| {
                    Value::Object(serde_json::Map::from_iter([
                        ("id".into(), Value::String(config.id.as_str().to_owned())),
                        ("name".into(), Value::String(config.name.clone())),
                        ("host".into(), Value::String(config.host.clone())),
                        ("port".into(), Value::from(config.port)),
                        ("username".into(), Value::String(config.username.clone())),
                        ("authMethod".into(), Value::String(auth_label(config.auth))),
                        (
                            "groupId".into(),
                            config
                                .group_id
                                .as_ref()
                                .map(|id| Value::String(id.as_str().to_owned()))
                                .unwrap_or(Value::Null),
                        ),
                        (
                            "online".into(),
                            Value::Bool(online.iter().any(|id| id == config.id.as_str())),
                        ),
                        (
                            "remark".into(),
                            Value::String(config.remark.clone().unwrap_or_default()),
                        ),
                    ]))
                })
                .collect();
            let summary = format!("共 {} 台已配置服务器", items.len());
            ToolOutcome::succeeded(
                summary,
                vec![ToolTargetOutcome {
                    conn_id: "-".into(),
                    conn_name: "配置清单".into(),
                    status: TargetStatus::Ok,
                    output: Some(serde_json::to_string(&items).unwrap_or_else(|_| "[]".to_owned())),
                    error: None,
                }],
            )
        }
        Err(err) => ToolOutcome::failed(format!("读取配置列表失败:{err}")),
    }
}

/// 写入共享记忆(批准已在 [`super::tool_host`] 完成;禁止写凭据)。
pub(crate) async fn remember(store: &Arc<dyn AgentStore>, arguments: &Value) -> ToolOutcome {
    let content = string_field(arguments, "content").unwrap_or_default();
    let scope = match string_field(arguments, "scope").as_deref() {
        Some("connection") => MemoryScope::Connection,
        _ => MemoryScope::Global,
    };
    let conn_id = string_field(arguments, "connId");
    if looks_like_secret(&content) {
        return ToolOutcome::failed("记忆内容疑似凭据或密钥,已拒绝写入");
    }
    let memory = match AgentMemory::new(
        match MemoryId::new(uuid::Uuid::new_v4().to_string()) {
            Ok(id) => id,
            Err(err) => return ToolOutcome::failed(err.to_string()),
        },
        scope,
        conn_id,
        content,
        true,
    ) {
        Ok(memory) => memory,
        Err(err) => return ToolOutcome::failed(err.to_string()),
    };
    if let Err(err) = store.upsert_memory(&memory) {
        return ToolOutcome::failed(format!("记忆写入失败:{err}"));
    }
    ToolOutcome::succeeded(
        "已写入共享记忆",
        vec![ToolTargetOutcome {
            conn_id: "-".into(),
            conn_name: "本地记忆".into(),
            status: TargetStatus::Ok,
            output: Some(memory.content),
            error: None,
        }],
    )
}

/// 在一台已批准的主机上执行工具,产出逐台结果。
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_on_target(
    connections: &Arc<ConnectionService>,
    sessions: &Arc<SessionService>,
    sftp: &Arc<SftpService>,
    context: &RunContext,
    tool: &str,
    conn_id: &str,
    conn_name: &str,
    arguments: &Value,
    argv: &[String],
) -> ToolTargetOutcome {
    if context.cancel.is_cancelled() {
        return outcome(
            conn_id,
            conn_name,
            TargetStatus::Cancelled,
            None,
            Some("运行已取消".into()),
        );
    }
    let Ok(id) = ConnId::new(conn_id) else {
        return outcome(
            conn_id,
            conn_name,
            TargetStatus::Failed,
            None,
            Some("主机标识非法".into()),
        );
    };
    // 详情类工具只需要配置,不需要连接。
    if tool == "connection_detail" {
        return match connections.connection(&id) {
            Ok(Some(config)) => {
                let detail = serde_json::json!({
                    "host": config.host,
                    "port": config.port,
                    "username": config.username,
                    "auth": auth_label(config.auth),
                    "privateKeyPath": config.private_key_path,
                    "encoding": encoding_label(config.encoding),
                    "tagColor": config.tag_color,
                    "remark": config.remark,
                    // 凭据只报"是否已保存",永不回显本体(AGENTS.md §7)。
                    "credentialStored": config.secret_ref_password.is_some()
                        || config.secret_ref_passphrase.is_some(),
                })
                .to_string();
                outcome(conn_id, &config.name, TargetStatus::Ok, Some(detail), None)
            }
            Ok(None) => outcome(
                conn_id,
                conn_name,
                TargetStatus::Failed,
                None,
                Some("该主机不在配置列表内".into()),
            ),
            Err(err) => outcome(
                conn_id,
                conn_name,
                TargetStatus::Failed,
                None,
                Some(format!("读取配置失败:{err}")),
            ),
        };
    }
    // 其余工具都需要一条在线会话。
    let info = match sessions.connect_by_conn(&id).await {
        Ok(info) => info,
        Err(err) => {
            let needs_user = matches!(
                err,
                crate::application::sessions::SessionError::CredentialsRequired
            );
            let message = if needs_user {
                "该主机需要补充登录凭据,请在界面完成认证后重试"
            } else {
                "连接失败"
            };
            return outcome(
                conn_id,
                conn_name,
                if needs_user {
                    TargetStatus::AwaitingApproval
                } else {
                    TargetStatus::Failed
                },
                None,
                Some(format!("{message}:{err}")),
            );
        }
    };
    if tool == "ensure_session" {
        let detail = serde_json::json!({
            "sessionId": info.session_id,
            "status": info.status.as_str(),
            "serverInfo": info.server_info.is_some(),
        })
        .to_string();
        return outcome(conn_id, conn_name, TargetStatus::Ok, Some(detail), None);
    }
    match dispatch_tool(
        sessions,
        sftp,
        context,
        tool,
        &info.session_id,
        arguments,
        argv,
    )
    .await
    {
        Ok(output) => outcome(conn_id, conn_name, TargetStatus::Ok, Some(output), None),
        Err(error) => outcome(conn_id, conn_name, TargetStatus::Failed, None, Some(error)),
    }
}

/// 在已建立会话的主机上执行具体动作。
async fn dispatch_tool(
    sessions: &Arc<SessionService>,
    sftp: &Arc<SftpService>,
    context: &RunContext,
    tool: &str,
    session_id: &str,
    arguments: &Value,
    argv: &[String],
) -> Result<String, String> {
    let timeout = Duration::from_secs(context.exec_timeout_secs.clamp(1, 120));
    let connection = sessions
        .connection_of(session_id)
        .map_err(|err| err.to_string())?;
    match tool {
        "exec" => {
            if argv.is_empty() {
                return Err("argv 不能为空".into());
            }
            connection
                .exec_once(&quote_argv(argv), timeout)
                .await
                .map_err(|err| err.to_string())
        }
        "server_info" => connection
            .exec_once(&quote_argv(&["uname".to_owned(), "-a".to_owned()]), timeout)
            .await
            .map_err(|err| err.to_string()),
        "read_file" => {
            let path = required_path(arguments)?;
            let limit = int_field(arguments, "maxBytes")
                .unwrap_or(MAX_READ_BYTES as i64)
                .clamp(1, MAX_READ_BYTES as i64) as usize;
            sftp.read_text(session_id, &path, limit)
                .await
                .map(|(text, truncated)| {
                    if truncated {
                        format!("{text}\n(已按字节上限截断)")
                    } else {
                        text
                    }
                })
                .map_err(|err| err.to_string())
        }
        "list_dir" => {
            let path = string_field(arguments, "path").unwrap_or_else(|| ".".into());
            let entries = sftp
                .list(session_id, &path)
                .await
                .map_err(|err| err.to_string())?;
            let items: Vec<Value> = entries
                .iter()
                .map(|entry| {
                    Value::Object(serde_json::Map::from_iter([
                        ("name".into(), Value::String(entry.name.clone())),
                        (
                            "type".into(),
                            Value::String(file_type_label(entry.file_type).to_owned()),
                        ),
                        ("size".into(), Value::from(entry.size)),
                        (
                            "mtime".into(),
                            entry.mtime.map(Value::from).unwrap_or(Value::Null),
                        ),
                        (
                            "owner".into(),
                            entry
                                .owner
                                .clone()
                                .map(Value::String)
                                .unwrap_or(Value::Null),
                        ),
                    ]))
                })
                .collect();
            Ok(serde_json::to_string(&items).unwrap_or_else(|_| "[]".into()))
        }
        "tail_log" => {
            let path = required_path(arguments)?;
            let lines = int_field(arguments, "lines").unwrap_or(200).clamp(1, 2000) as usize;
            sftp.read_text(session_id, &path, MAX_READ_BYTES as usize)
                .await
                .map(|(text, _)| last_lines(&text, lines))
                .map_err(|err| err.to_string())
        }
        "write_file" => {
            let path = required_path(arguments)?;
            let content = arguments
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let append = string_field(arguments, "mode").as_deref() == Some("append");
            sftp.write_text(session_id, &path, content, append)
                .await
                .map(|()| format!("已写入 {} 字节", content.chars().count()))
                .map_err(|err| err.to_string())
        }
        "remove_path" => {
            let path = required_path(arguments)?;
            let failures = sftp
                .delete(session_id, std::slice::from_ref(&path))
                .await
                .map_err(|err| err.to_string())?;
            if failures.is_empty() {
                Ok(format!("已删除 {path}"))
            } else {
                Ok(failures
                    .iter()
                    .map(|item| format!("{}:{}", item.path, item.message))
                    .collect::<Vec<_>>()
                    .join(";"))
            }
        }
        "rename_path" => {
            let old = string_field(arguments, "oldPath").ok_or("缺少 oldPath")?;
            let new = string_field(arguments, "newPath").ok_or("缺少 newPath")?;
            check_write_path(&old).map_err(|err| err.to_string())?;
            check_write_path(&new).map_err(|err| err.to_string())?;
            let new_name = new.rsplit('/').next().unwrap_or(new.as_str()).to_owned();
            sftp.rename(session_id, &old, &new_name)
                .await
                .map(|()| format!("已重命名 {old} → {new_name}"))
                .map_err(|err| err.to_string())
        }
        "set_permissions" => {
            let path = required_path(arguments)?;
            let mode = string_field(arguments, "mode").ok_or("缺少 mode")?;
            let bits = parse_mode(&mode).ok_or_else(|| format!("非法权限值:{mode}"))?;
            sftp.set_permissions(session_id, &path, bits)
                .await
                .map(|()| format!("已设置 {path} 权限为 {mode}"))
                .map_err(|err| err.to_string())
        }
        other => Err(format!("未实现的工具:{other}")),
    }
}

/// 逐台结果构造(输出统一做截断摘要,错误原文保留)。
fn outcome(
    conn_id: &str,
    conn_name: &str,
    status: TargetStatus,
    output: Option<String>,
    error: Option<String>,
) -> ToolTargetOutcome {
    ToolTargetOutcome {
        conn_id: conn_id.to_owned(),
        conn_name: conn_name.to_owned(),
        status,
        output: output.map(|value| excerpt(&value)),
        error,
    }
}

/// 取必填的远端绝对路径并校验。
fn required_path(arguments: &Value) -> Result<String, String> {
    let path = string_field(arguments, "path").ok_or("缺少 path")?;
    check_read_path(&path).map_err(|err| err.to_string())?;
    Ok(path)
}

/// 认证方式的稳定英文标识(与 IPC 契约字面量一致)。
fn auth_label(auth: crate::domain::connection::AuthMethod) -> String {
    serde_json::to_value(crate::dto::connection::AuthMethodDto::from(auth))
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "password".into())
}

/// 编码标识(领域类型不带序列化,这里显式映射)。
fn encoding_label(encoding: crate::domain::connection::Encoding) -> &'static str {
    match encoding {
        crate::domain::connection::Encoding::Utf8 => "utf-8",
        crate::domain::connection::Encoding::Gbk => "gbk",
    }
}

/// 文件类型标签(`RemoteFileType` 未实现序列化,这里显式映射成稳定字面量)。
fn file_type_label(file_type: crate::application::ports::RemoteFileType) -> &'static str {
    use crate::application::ports::RemoteFileType;
    match file_type {
        RemoteFileType::Dir => "dir",
        RemoteFileType::File => "file",
        RemoteFileType::Symlink => "symlink",
        RemoteFileType::Other => "other",
    }
}

/// 取末尾 `lines` 行。
fn last_lines(text: &str, lines: usize) -> String {
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(lines);
    all[start..].join("\n")
}

/// 解析八进制权限串(如 `644`、`0755`)。
fn parse_mode(mode: &str) -> Option<u32> {
    let trimmed = mode.trim();
    if trimmed.is_empty() || !trimmed.chars().all(|ch| ('0'..='7').contains(&ch)) {
        return None;
    }
    u32::from_str_radix(trimmed, 8).ok()
}

/// 粗略判断记忆内容是否像凭据(命中即拒写,AGENTS.md §7)。
fn looks_like_secret(text: &str) -> bool {
    let lower = text.to_lowercase();
    [
        "password",
        "passwd",
        "api_key",
        "apikey",
        "secret",
        "token",
        "private key",
        "begin rsa private",
        "密码",
        "口令",
        "密钥",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::agent::tool_host::EXCERPT_CHARS;

    /// 取末尾行不越界。
    #[test]
    fn last_lines_handles_short_input() {
        assert_eq!(last_lines("a\nb\nc", 2), "b\nc");
        assert_eq!(last_lines("a", 10), "a");
        assert_eq!(last_lines("", 3), "");
    }

    /// 权限解析只接受八进制。
    #[test]
    fn mode_parsing_is_octal_only() {
        assert_eq!(parse_mode("644"), Some(0o644));
        assert_eq!(parse_mode("0755"), Some(0o755));
        assert_eq!(parse_mode("778"), None);
        assert_eq!(parse_mode(""), None);
    }

    /// 凭据样内容被拒。
    #[test]
    fn secret_looking_memory_is_rejected() {
        assert!(looks_like_secret("nginx password is abc"));
        assert!(looks_like_secret("登录密码：123"));
        assert!(!looks_like_secret("日志在 /data/logs/app.log"));
    }

    /// 必填路径缺失与非法都要报错(不允许静默用当前目录)。
    #[test]
    fn required_path_validates() {
        let ok: Value = serde_json::from_str(r#"{"path":"/var/log/a.log"}"#).unwrap();
        assert_eq!(required_path(&ok).unwrap(), "/var/log/a.log");
        let missing: Value = serde_json::from_str("{}").unwrap();
        assert!(required_path(&missing).is_err());
        let relative: Value = serde_json::from_str(r#"{"path":"a/b"}"#).unwrap();
        assert!(required_path(&relative).is_err());
    }

    /// 标签映射覆盖全部取值。
    #[test]
    fn labels_are_mapped() {
        use crate::application::ports::RemoteFileType;
        assert_eq!(file_type_label(RemoteFileType::Dir), "dir");
        assert_eq!(file_type_label(RemoteFileType::Symlink), "symlink");
        assert_eq!(
            encoding_label(crate::domain::connection::Encoding::Gbk),
            "gbk"
        );
        assert_eq!(
            auth_label(crate::domain::connection::AuthMethod::Agent),
            "agent"
        );
    }

    /// 逐台结果对输出做截断摘要。
    #[test]
    fn outcome_excerpts_output() {
        let long = "字".repeat(EXCERPT_CHARS + 10);
        let item = outcome("c1", "web-01", TargetStatus::Ok, Some(long), None);
        assert!(item.output.unwrap().contains("已截断 10 字"));
        assert_eq!(item.conn_name, "web-01");
    }
}
