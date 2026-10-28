//! 本机 shell 执行:`LocalExec` 端口的 tokio::process 实现(AGENTS.md §4.5/§7)。
//!
//! Windows 用 `cmd /d /s /c`(/d 禁 AutoRun、/s 引号语义稳定、无 profile 副作用;
//! 需要 PowerShell 语义时由模型显式 `powershell -Command …`),其它平台用 `sh -c`。
//! 超时用 `tokio::time::timeout` 包"双流收集 + 等待",进程 `kill_on_drop`,
//! stdout+stderr 合计超限即停止收集;输出按有损 UTF-8 回传(与远端 exec_once 同口径,
//! cmd 非 UTF-8 代码页的乱码如实呈现)。

use std::path::Path;
use std::process::Stdio;

use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::application::local_ports::{LocalExec, LocalExecFault, LocalExecOutcome};

/// tokio 版本的本机执行器(无状态)。
#[derive(Debug, Default)]
pub struct TokioLocalExec;

impl TokioLocalExec {
    /// 构造。
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

/// 平台 shell 参数:Windows 走 cmd,其它平台走 sh。
fn shell_argv(command: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![
            "cmd".into(),
            "/d".into(),
            "/s".into(),
            "/c".into(),
            command.to_owned(),
        ]
    } else {
        vec!["sh".into(), "-c".into(), command.to_owned()]
    }
}

#[async_trait::async_trait]
impl LocalExec for TokioLocalExec {
    async fn run(
        &self,
        command: &str,
        cwd: &Path,
        timeout: std::time::Duration,
        max_output_bytes: usize,
    ) -> Result<LocalExecOutcome, LocalExecFault> {
        let mut argv = shell_argv(command);
        let program = argv.remove(0);
        let mut child = Command::new(&program)
            .args(&argv)
            .current_dir(cwd)
            .kill_on_drop(true)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| {
                LocalExecFault(format!(
                    "命令无法启动(在 {} 下执行 {program}):{err}",
                    cwd.display()
                ))
            })?;
        let mut stdout_pipe = child.stdout.take();
        let mut stderr_pipe = child.stderr.take();

        // 双流并发收集,合计超限即停止读取(进程仍在跑,由超时/退出收尾)。
        let collect = async {
            let mut stdout: Vec<u8> = Vec::new();
            let mut stderr: Vec<u8> = Vec::new();
            let mut truncated = false;
            let mut out_buf = [0u8; 8192];
            let mut err_buf = [0u8; 8192];
            loop {
                let mut progressed = false;
                if let Some(pipe) = stdout_pipe.as_mut() {
                    match pipe.read(&mut out_buf).await {
                        Ok(0) => stdout_pipe = None,
                        Ok(n) => {
                            progressed = true;
                            if stdout.len() + stderr.len() < max_output_bytes {
                                let room = max_output_bytes - stdout.len() - stderr.len();
                                stdout.extend_from_slice(&out_buf[..n.min(room)]);
                                if n > room {
                                    truncated = true;
                                }
                            } else {
                                truncated = true;
                            }
                        }
                        Err(err) => {
                            tracing::warn!("本机命令 stdout 读取失败: {err}");
                            stdout_pipe = None;
                        }
                    }
                }
                if let Some(pipe) = stderr_pipe.as_mut() {
                    match pipe.read(&mut err_buf).await {
                        Ok(0) => stderr_pipe = None,
                        Ok(n) => {
                            progressed = true;
                            if stdout.len() + stderr.len() < max_output_bytes {
                                let room = max_output_bytes - stdout.len() - stderr.len();
                                stderr.extend_from_slice(&err_buf[..n.min(room)]);
                                if n > room {
                                    truncated = true;
                                }
                            } else {
                                truncated = true;
                            }
                        }
                        Err(err) => {
                            tracing::warn!("本机命令 stderr 读取失败: {err}");
                            stderr_pipe = None;
                        }
                    }
                }
                if stdout_pipe.is_none() && stderr_pipe.is_none() {
                    break;
                }
                if !progressed {
                    // 两路都暂无数据但还有流开着:让出,等下一批(避免忙转)。
                    tokio::task::yield_now().await;
                }
            }
            (stdout, stderr, truncated)
        };

        let mut timed_out = false;
        let collected = match tokio::time::timeout(timeout, collect).await {
            Ok(result) => result,
            Err(_) => {
                timed_out = true;
                // 超时:kill 进程(忽略失败 —— kill_on_drop 也会兜底),不再等流收尾。
                let _ = child.kill().await;
                (Vec::new(), Vec::new(), false)
            }
        };
        let exit_code = if timed_out {
            None
        } else {
            match child.wait().await {
                Ok(status) => status.code(),
                Err(err) => {
                    tracing::warn!("本机命令等待退出失败: {err}");
                    None
                }
            }
        };
        let (stdout, stderr, mut truncated) = collected;
        if timed_out {
            // 超时路径没有收集到输出,如实置空;截断标记无意义。
            truncated = false;
        }
        Ok(LocalExecOutcome {
            exit_code,
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            truncated,
            timed_out,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("临时目录创建失败")
    }

    #[test]
    fn shell_argv_matches_platform() {
        let argv = shell_argv("echo hi");
        if cfg!(windows) {
            assert_eq!(argv[..4], ["cmd", "/d", "/s", "/c"]);
        } else {
            assert_eq!(argv[..2], ["sh", "-c"]);
        }
        assert_eq!(argv.last().map(String::as_str), Some("echo hi"));
    }

    #[tokio::test]
    async fn runs_command_in_cwd_and_reports_exit_code() {
        let dir = temp_dir();
        let exec = TokioLocalExec::new();
        let outcome = exec
            .run("echo hello", dir.path(), Duration::from_secs(10), 1024)
            .await
            .unwrap();
        assert_eq!(outcome.exit_code, Some(0));
        assert!(
            outcome.stdout.trim().contains("hello"),
            "stdout:{}",
            outcome.stdout
        );
        assert!(!outcome.timed_out);
    }

    #[tokio::test]
    async fn nonzero_exit_is_outcome_not_fault() {
        let dir = temp_dir();
        let exec = TokioLocalExec::new();
        let fail = if cfg!(windows) { "exit /b 3" } else { "exit 3" };
        let outcome = exec
            .run(fail, dir.path(), Duration::from_secs(10), 1024)
            .await
            .unwrap();
        assert_eq!(outcome.exit_code, Some(3));
    }

    #[tokio::test]
    async fn timeout_kills_and_flags() {
        let dir = temp_dir();
        let exec = TokioLocalExec::new();
        let hang = if cfg!(windows) {
            "ping -n 30 127.0.0.1 > nul"
        } else {
            "sleep 30"
        };
        let started = std::time::Instant::now();
        let outcome = exec
            .run(hang, dir.path(), Duration::from_secs(1), 1024)
            .await
            .unwrap();
        assert!(outcome.timed_out);
        assert!(outcome.exit_code.is_none());
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[tokio::test]
    async fn missing_cwd_is_friendly_fault() {
        let exec = TokioLocalExec::new();
        let err = exec
            .run(
                "echo hi",
                Path::new("Z:/definitely/not/here"),
                Duration::from_secs(5),
                1024,
            )
            .await
            .unwrap_err();
        assert!(err.0.contains("无法启动"), "实际:{err}");
    }

    #[tokio::test]
    async fn output_cap_truncates() {
        let dir = temp_dir();
        let exec = TokioLocalExec::new();
        // 输出明显超过 16 字节。
        let outcome = exec
            .run(
                "echo 0123456789abcdefghij",
                dir.path(),
                Duration::from_secs(10),
                16,
            )
            .await
            .unwrap();
        assert!(outcome.truncated);
        assert!(outcome.stdout.len() <= 16, "stdout:{}", outcome.stdout);
    }
}
