//! 语义索引适配器的行为测试(基础设施层,AGENTS.md §9)。

use std::sync::Arc;

use crate::application::agent::semantic::{SemanticIndex, SemanticStatus};
use crate::application::agent::tool_host_tests::NullStore;
use crate::infrastructure::semantic::FastembedSemanticIndex;

/// 回归:prepare 曾用 tokio::spawn,同步 command 在主线程(无 Tokio 上下文)上
/// 调用时直接 panic,进程闪退。现走 tauri::async_runtime::spawn,任意线程可调
/// (端口契约);模型目录缺失时后台任务应落 Failed(点名缺失文件),不崩进程。
#[test]
fn prepare_from_plain_thread_does_not_panic() {
    let dir = std::env::temp_dir().join("shelx-semantic-prepare-regression");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("临时目录创建失败");
    let index = Arc::new(
        FastembedSemanticIndex::open(
            &dir.join("vectors.db"),
            Arc::new(NullStore),
            dir.join("missing-model"),
        )
        .expect("语义索引打开失败"),
    );

    // 在无 Tokio 运行时的普通线程上触发,模拟主线程上的同步 command。
    let trigger = Arc::clone(&index);
    std::thread::spawn(move || trigger.prepare())
        .join()
        .expect("prepare 在无 Tokio 上下文的线程上不得 panic");

    // 后台任务收尾:模型缺失 → Failed 带缺失清单(可重试,不留死状态)。
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        match index.status() {
            SemanticStatus::Failed { message } => {
                assert!(message.contains("model_quantized.onnx"), "{message}");
                break;
            }
            _ => {
                if std::time::Instant::now() > deadline {
                    panic!("prepare 未在期限内落 Failed(最后状态:{:?})", index.status());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    }
}
