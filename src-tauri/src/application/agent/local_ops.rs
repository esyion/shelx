//! 本机工作区工具的单目标执行(镜像 `tool_ops` 的风格;路径与命令的强制边界在
//! `WorkspaceFs` 端口实现里,这里只做参数取值与结果组织)。
//!
//! 目标固定为哨兵 `LOCAL_TARGET_ID`(审批/审计/事件与远端主机同一管线),
//! 工作区根来自 `RunContext.workspace`(运行期快照,不随工作区删除而失效)。

use std::time::Duration;

use serde_json::Value;

use super::types::RunContext;
use crate::application::local_ports::{LocalExec, WorkspaceFs};
use crate::domain::agent::ToolCategory;

/// 单次本机命令输出采集上限(stdout+stderr 合计;超限停止收集并标记截断)。
pub(crate) const LOCAL_EXEC_MAX_OUTPUT_BYTES: usize = 256 * 1024;
/// `local_read_file` 单次读取上限(与远端 `read_file` 一致)。
const LOCAL_READ_MAX_BYTES: u64 = 64 * 1024;
/// 命令字符串在审批卡说明里的展示上限。
const REASON_COMMAND_CHARS: usize = 120;

/// 执行一个本机工具;返回模型可读的输出文本,失败返回面向用户的错误原文。
///
/// # Errors
/// 工作区未绑定、参数缺失、路径越界、命令失败或超时(消息含原始输出,不吞错)。
pub(crate) async fn dispatch(
    exec: &dyn LocalExec,
    fs: &dyn WorkspaceFs,
    context: &RunContext,
    tool: &str,
    arguments: &Value,
) -> Result<String, String> {
    let Some(workspace) = context.workspace.as_ref() else {
        return Err("本对话未绑定本机工作区,请先在对话抬头选择一个本机文件夹".into());
    };
    let root = workspace.root.as_str();
    match tool {
        "local_exec" => local_exec(exec, context, root, arguments).await,
        "local_read_file" => local_read_file(fs, root, arguments),
        "local_list_dir" => local_list_dir(fs, root, arguments),
        "local_write_file" => local_write_file(fs, root, arguments),
        "local_remove_path" => {
            let path = required_string(arguments, "path")?;
            fs.remove(root, &path)
                .map(|_| "已删除(不递归,只删这一个文件或空目录)".to_owned())
        }
        "local_rename_path" => {
            let old_path = required_string(arguments, "oldPath")?;
            let new_path = required_string(arguments, "newPath")?;
            fs.rename(root, &old_path, &new_path)
                .map(|_| "已重命名".to_owned())
        }
        _ => Err(format!("未知本机工具:{tool}")),
    }
}

/// 审批卡说明:本机工具要在用户批准前说清"将在这台机器上做什么"。
pub(crate) fn reason_for(tool: &str, arguments: &Value, category: ToolCategory) -> String {
    let command = arguments
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let head: String = command.chars().take(REASON_COMMAND_CHARS).collect();
    match tool {
        "local_exec" => format!("将在本机工作区执行命令:{head}"),
        _ if category == ToolCategory::Mutating => "将改动本机工作区里的文件".to_owned(),
        _ => "将读取本机工作区里的内容".to_owned(),
    }
}

/// `local_exec`:系统 shell 执行,超时杀进程,非零退出码把输出带回模型。
async fn local_exec(
    exec: &dyn LocalExec,
    context: &RunContext,
    root: &str,
    arguments: &Value,
) -> Result<String, String> {
    let command = required_string(arguments, "command")?;
    if command.trim().is_empty() {
        return Err("命令不能为空".into());
    }
    let timeout_secs = arguments
        .get("timeoutSecs")
        .and_then(Value::as_u64)
        .unwrap_or(context.local_exec_timeout_secs)
        .clamp(1, 600);
    if context.cancel.is_cancelled() {
        return Err("运行已取消,命令未执行".into());
    }
    let cwd = std::path::PathBuf::from(root);
    let result = exec
        .run(
            &command,
            &cwd,
            Duration::from_secs(timeout_secs),
            LOCAL_EXEC_MAX_OUTPUT_BYTES,
        )
        .await
        .map_err(|fault| fault.to_string())?;
    if context.cancel.is_cancelled() {
        return Err("运行已取消".into());
    }
    let mut output = String::new();
    if !result.stdout.trim().is_empty() {
        output.push_str(&result.stdout);
    }
    if !result.stderr.trim().is_empty() {
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str("[stderr]\n");
        output.push_str(&result.stderr);
    }
    if result.timed_out {
        return Err(format!(
            "命令执行超过 {timeout_secs} 秒,已被终止。终止前的输出:\n{output}"
        ));
    }
    if result.truncated {
        output.push_str("\n(输出超过上限被截断;可改写命令收窄输出范围后重试)");
    }
    match result.exit_code {
        Some(0) => Ok(if output.trim().is_empty() {
            "(命令执行成功,无输出)".to_owned()
        } else {
            output
        }),
        Some(code) => Err(format!(
            "命令以退出码 {code} 结束,可能未达到目的:\n{output}"
        )),
        None => Err(format!("命令退出状态未知:\n{output}")),
    }
}

/// `local_read_file`:工作区内文本读取(64 KiB 上限,与远端一致)。
fn local_read_file(fs: &dyn WorkspaceFs, root: &str, arguments: &Value) -> Result<String, String> {
    let path = required_string(arguments, "path")?;
    let max_bytes = arguments
        .get("maxBytes")
        .and_then(Value::as_u64)
        .unwrap_or(LOCAL_READ_MAX_BYTES)
        .clamp(1, LOCAL_READ_MAX_BYTES);
    let (text, truncated) = fs.read_text(root, &path, max_bytes)?;
    Ok(if truncated {
        format!("{text}\n(已按字节上限截断,需要更多内容请分段读取)")
    } else {
        text
    })
}

/// `local_list_dir`:工作区内目录列表(缺省列出根目录)。
fn local_list_dir(fs: &dyn WorkspaceFs, root: &str, arguments: &Value) -> Result<String, String> {
    let path = arguments
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let entries = fs.list(root, &path)?;
    if entries.is_empty() {
        return Ok("(目录为空)".to_owned());
    }
    let mut lines = Vec::with_capacity(entries.len());
    for entry in entries {
        if entry.is_dir {
            lines.push(format!("{}/  (目录)", entry.name));
        } else {
            let size = entry
                .size
                .map(|bytes| format!("  {bytes} 字节"))
                .unwrap_or_default();
            lines.push(format!("{}{size}", entry.name));
        }
    }
    Ok(lines.join("\n"))
}

/// `local_write_file`:工作区内写入/追加(父目录自动创建)。
fn local_write_file(fs: &dyn WorkspaceFs, root: &str, arguments: &Value) -> Result<String, String> {
    let path = required_string(arguments, "path")?;
    let content = required_string(arguments, "content")?;
    let append = arguments.get("mode").and_then(Value::as_str) == Some("append");
    let written = fs.write(root, &path, &content, append)?;
    Ok(format!(
        "已{} {written} 字节到 {path}",
        if append { "追加" } else { "写入" }
    ))
}

/// 取必填字符串参数。
fn required_string(arguments: &Value, key: &str) -> Result<String, String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("缺少 {key}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::agent::types::WorkspaceScope;
    use crate::application::local_ports::{LocalExecFault, LocalExecOutcome, WorkspaceListing};
    use std::sync::Arc;
    use std::sync::Mutex as StdMutex;

    fn context_with_workspace() -> RunContext {
        RunContext {
            thread_id: "t1".into(),
            run_id: "r1".into(),
            approval: crate::domain::agent::ApprovalMode::ReadOnlyAuto,
            bound_conn_id: None,
            workspace: Some(WorkspaceScope {
                id: "w1".into(),
                name: "演示".into(),
                root: "C:/ws".into(),
            }),
            batch_limit: 5,
            parallel_hosts: 4,
            exec_timeout_secs: 30,
            local_exec_timeout_secs: 120,
            web_search_enabled: false,
            cancel: super::super::hub::CancelToken::new(),
        }
    }

    struct FakeExec {
        calls: StdMutex<Vec<(String, String)>>,
        result: LocalExecOutcome,
    }
    #[async_trait::async_trait]
    impl LocalExec for FakeExec {
        async fn run(
            &self,
            command: &str,
            cwd: &std::path::Path,
            _timeout: Duration,
            _max: usize,
        ) -> Result<LocalExecOutcome, LocalExecFault> {
            self.calls
                .lock()
                .unwrap()
                .push((command.to_owned(), cwd.display().to_string()));
            Ok(self.result.clone())
        }
    }

    struct FakeFs;
    impl WorkspaceFs for FakeFs {
        fn resolve_root(&self, raw: &str) -> Result<String, String> {
            Ok(raw.to_owned())
        }
        fn read_text(&self, _root: &str, path: &str, _max: u64) -> Result<(String, bool), String> {
            match path {
                "ok.txt" => Ok(("内容".into(), false)),
                "escape" => Err("只接受工作区内的路径".into()),
                _ => Err("文件不存在".into()),
            }
        }
        fn list(&self, _root: &str, path: &str) -> Result<Vec<WorkspaceListing>, String> {
            assert_eq!(path, "", "缺省应列根目录");
            Ok(vec![WorkspaceListing {
                name: "src".into(),
                is_dir: true,
                size: None,
                mtime: None,
            }])
        }
        fn write(
            &self,
            _root: &str,
            path: &str,
            content: &str,
            append: bool,
        ) -> Result<u64, String> {
            assert!(path.starts_with("out/"));
            let _ = (content, append);
            Ok(content.len() as u64)
        }
        fn remove(&self, _root: &str, _path: &str) -> Result<(), String> {
            Ok(())
        }
        fn rename(&self, _root: &str, _old: &str, _new: &str) -> Result<(), String> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn exec_success_and_cwd_binding() {
        let exec = Arc::new(FakeExec {
            calls: StdMutex::new(Vec::new()),
            result: LocalExecOutcome {
                exit_code: Some(0),
                stdout: "done".into(),
                stderr: String::new(),
                truncated: false,
                timed_out: false,
            },
        });
        let fs: Arc<dyn WorkspaceFs> = Arc::new(FakeFs);
        let context = context_with_workspace();
        let args = serde_json::json!({"command": "echo done"});
        let output = dispatch(exec.as_ref(), fs.as_ref(), &context, "local_exec", &args)
            .await
            .unwrap();
        assert_eq!(output, "done");
        let calls = exec.calls.lock().unwrap();
        assert_eq!(calls[0].0, "echo done");
        assert_eq!(calls[0].1, "C:/ws", "cwd 必须固定为工作区根");
    }

    #[tokio::test]
    async fn exec_nonzero_exit_keeps_output_in_error() {
        let exec = Arc::new(FakeExec {
            calls: StdMutex::new(Vec::new()),
            result: LocalExecOutcome {
                exit_code: Some(2),
                stdout: "half work".into(),
                stderr: "boom".into(),
                truncated: false,
                timed_out: false,
            },
        });
        let fs: Arc<dyn WorkspaceFs> = Arc::new(FakeFs);
        let context = context_with_workspace();
        let err = dispatch(
            exec.as_ref(),
            fs.as_ref(),
            &context,
            "local_exec",
            &serde_json::json!({"command": "x"}),
        )
        .await
        .unwrap_err();
        assert!(err.contains("退出码 2"), "实际:{err}");
        assert!(
            err.contains("half work") && err.contains("boom"),
            "输出不能被吞:{err}"
        );
    }

    #[tokio::test]
    async fn exec_timeout_reports_seconds() {
        let exec = Arc::new(FakeExec {
            calls: StdMutex::new(Vec::new()),
            result: LocalExecOutcome {
                exit_code: None,
                stdout: "partial".into(),
                stderr: String::new(),
                truncated: false,
                timed_out: true,
            },
        });
        let fs: Arc<dyn WorkspaceFs> = Arc::new(FakeFs);
        let context = context_with_workspace();
        let err = dispatch(
            exec.as_ref(),
            fs.as_ref(),
            &context,
            "local_exec",
            &serde_json::json!({"command": "sleep"}),
        )
        .await
        .unwrap_err();
        assert!(
            err.contains("120 秒") && err.contains("partial"),
            "实际:{err}"
        );
    }

    #[tokio::test]
    async fn read_escapes_rejected_and_default_listing() {
        let fs: Arc<dyn WorkspaceFs> = Arc::new(FakeFs);
        let context = context_with_workspace();
        assert!(dispatch(
            noop_exec_ref(),
            fs.as_ref(),
            &context,
            "local_read_file",
            &serde_json::json!({"path": "escape"})
        )
        .await
        .is_err());
        let listing = dispatch(
            noop_exec_ref(),
            fs.as_ref(),
            &context,
            "local_list_dir",
            &serde_json::json!({}),
        )
        .await
        .unwrap();
        assert!(listing.contains("src/"), "实际:{listing}");
    }

    #[tokio::test]
    async fn write_creates_parents_and_reports_bytes() {
        let fs: Arc<dyn WorkspaceFs> = Arc::new(FakeFs);
        let context = context_with_workspace();
        let out = dispatch(
            noop_exec_ref(),
            fs.as_ref(),
            &context,
            "local_write_file",
            &serde_json::json!({"path": "out/a.txt", "content": "你好"}),
        )
        .await
        .unwrap();
        assert!(out.contains("6 字节"), "实际:{out}");
    }

    #[tokio::test]
    async fn missing_workspace_is_clear_error() {
        let fs: Arc<dyn WorkspaceFs> = Arc::new(FakeFs);
        let mut context = context_with_workspace();
        context.workspace = None;
        let err = dispatch(
            noop_exec_ref(),
            fs.as_ref(),
            &context,
            "local_list_dir",
            &serde_json::json!({}),
        )
        .await
        .unwrap_err();
        assert!(err.contains("未绑定本机工作区"), "实际:{err}");
    }

    #[tokio::test]
    async fn missing_required_fields_rejected() {
        let fs: Arc<dyn WorkspaceFs> = Arc::new(FakeFs);
        let context = context_with_workspace();
        assert!(dispatch(
            noop_exec_ref(),
            fs.as_ref(),
            &context,
            "local_read_file",
            &serde_json::json!({})
        )
        .await
        .is_err());
        assert!(dispatch(
            noop_exec_ref(),
            fs.as_ref(),
            &context,
            "local_exec",
            &serde_json::json!({"command": "  "})
        )
        .await
        .is_err());
    }

    /// 永不被调到的执行器引用(只读/写路径用不到;测试进程内泄漏一次无妨)。
    fn noop_exec_ref() -> &'static FakeExec {
        Box::leak(Box::new(noop_exec_value()))
    }

    /// 永不被调到的执行器(只读/写路径用不到)。
    fn noop_exec_value() -> FakeExec {
        FakeExec {
            calls: StdMutex::new(Vec::new()),
            result: LocalExecOutcome {
                exit_code: Some(0),
                stdout: String::new(),
                stderr: String::new(),
                truncated: false,
                timed_out: false,
            },
        }
    }
}
