//! 全局日志初始化(设计文档 §7.1 / §7.5)。
//!
//! 双输出:stdout(开发期直观)+ 数据目录 `logs/shelx.log`(按日滚动,排查问题)。
//! 文件目录不可用时降级为仅 stdout,日志失败绝不阻断应用启动。
//! 默认级别 info,可用 `RUST_LOG` 环境变量覆盖;凭据与密钥内容禁止写入日志。

use std::path::Path;

use tracing_subscriber::{fmt, prelude::*};

/// 初始化全局 tracing 订阅者;`file_dir` 为 `None` 时仅输出到 stdout。
///
/// 只能调用一次(重复调用由 tracing 自行忽略),在 `lib::run` 最先执行。
pub fn init(file_dir: Option<&Path>) {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    let stdout = fmt::layer().with_target(false);

    match file_dir {
        Some(dir) => {
            let appender = tracing_appender::rolling::daily(dir.join("logs"), "shelx.log");
            let file = fmt::layer().with_ansi(false).with_writer(appender);
            tracing_subscriber::registry()
                .with(filter)
                .with(stdout)
                .with(file)
                .init();
        }
        None => {
            tracing_subscriber::registry()
                .with(filter)
                .with(stdout)
                .init();
        }
    }
}
