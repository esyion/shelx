//! 全局日志初始化(设计文档 §7.1 / §7.5)。
//!
//! 双输出:stdout(开发期直观)+ 数据目录 `logs/shelx.log`(按日滚动,排查问题)。
//! 文件目录不可用时降级为仅 stdout,日志失败绝不阻断应用启动。
//! 默认级别 info,可用 `RUST_LOG` 环境变量覆盖;凭据与密钥内容禁止写入日志。
//! 时间戳按用户本地时区输出(启动时捕获偏移并固定),而非默认的 UTC。

use std::path::Path;

use time::format_description::well_known::Rfc3339;
use time::UtcOffset;
use tracing_subscriber::fmt::time::OffsetTime;
use tracing_subscriber::{fmt, prelude::*};

/// 生成本地时区时间戳 timer,输出形如 `2026-10-22T16:15:35.290994+08:00`。
///
/// 本机 UTC 偏移在 `init` 阶段(线程尚少、最早执行处)一次性捕获,整个运行期固定使用;
/// 检测失败(部分平台多线程下不可确定)时回退 UTC,保证时间戳在任何平台都能稳定输出。
fn local_timer() -> OffsetTime<Rfc3339> {
    let offset = UtcOffset::current_local_offset().unwrap_or(UtcOffset::UTC);
    OffsetTime::new(offset, Rfc3339)
}

/// 初始化全局 tracing 订阅者;`file_dir` 为 `None` 时仅输出到 stdout。
///
/// 只能调用一次(重复调用由 tracing 自行忽略),在 `lib::run` 最先执行。
pub fn init(file_dir: Option<&Path>) {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    let stdout = fmt::layer().with_target(false).with_timer(local_timer());

    match file_dir {
        Some(dir) => {
            let appender = tracing_appender::rolling::daily(dir.join("logs"), "shelx.log");
            let file = fmt::layer()
                .with_ansi(false)
                .with_writer(appender)
                .with_timer(local_timer());
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
