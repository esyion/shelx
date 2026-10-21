//! 命令与路径策略:把一次工具调用判成"只读取证"还是"会改动世界"(AGENTS.md §4.5)。
//!
//! 这是全项目唯一的分类口径:审批档位、IPC 的 `category` 字段、界面文案都从这里出,
//! 禁止前端另行判断"这条命令看起来安全"(docs/AGENT_DESIGN.md §13.9)。

use serde::{Deserialize, Serialize};

/// 工具调用对世界的影响类别。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolCategory {
    /// 只读取证,不改变远端状态。
    ReadOnly,
    /// 会改变远端状态(执行命令、写文件、改权限)。
    Mutating,
    /// 建立一条新的 SSH 连接(可能触发认证交互与 TOFU 确认)。
    Connect,
}

impl ToolCategory {
    /// 稳定字面量。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadOnly => "read_only",
            Self::Mutating => "mutating",
            Self::Connect => "connect",
        }
    }

    /// 界面主文案(中文,内部枚举原值不外泄)。
    pub fn display_name(self) -> &'static str {
        match self {
            Self::ReadOnly => "只读取证",
            Self::Mutating => "改动服务器",
            Self::Connect => "新建连接",
        }
    }
}

/// 分类结论与原因(原因用于写审计与给用户解释为什么要点批准)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandDecision {
    /// 判定类别。
    pub category: ToolCategory,
    /// 人话原因(审计与界面展示用)。
    pub reason: String,
}

impl CommandDecision {
    /// 构造结论。
    pub fn new(category: ToolCategory, reason: impl Into<String>) -> Self {
        Self {
            category,
            reason: reason.into(),
        }
    }

    /// 是否只读。
    pub fn is_read_only(&self) -> bool {
        self.category == ToolCategory::ReadOnly
    }
}

/// 单次读取远端文件的字节上限(超出截断并把事实告诉模型,docs/AGENT_DESIGN.md §17 R6)。
pub const MAX_READ_BYTES: u64 = 64 * 1024;

/// 出现在任何参数里都立刻判为写操作的控制符(shell 语义,绝不拼接执行)。
const SHELL_CONTROL_TOKENS: [&str; 10] = [";", "&&", "||", "|", ">", ">>", "<", "`", "$(", "${"];

/// 会写文件或改状态的参数标记:命中即按写操作处理(宁可多问一次,不做"看起来安全"的猜测)。
const DENY_ARG_TOKENS: [&str; 12] = [
    "-o", "--output", "-output", "--out", "-out", "-delete", "--delete", "-exec", "-exec2", "-ok",
    "-fprint", "-fls",
];

/// 可改写世界或外联的可执行文件:即便带"看似只读"的参数也只按写处理。
const NEVER_READ_ONLY_BINS: [&str; 22] = [
    "sh", "bash", "zsh", "dash", "ksh", "fish", "python", "python2", "python3", "perl", "ruby",
    "node", "php", "awk", "gawk", "xargs", "sudo", "su", "doas", "ssh", "scp", "rsync",
];

/// 明确只读的二进制及其安全参数约束(空切片表示参数任意仍为只读)。
const READ_ONLY_COMMANDS: &[(&str, &[&str])] = &[
    ("uname", &[]),
    ("hostname", &[]),
    ("uptime", &[]),
    ("date", &[]),
    ("whoami", &[]),
    ("id", &[]),
    ("ps", &[]),
    ("pgrep", &[]),
    ("pidof", &[]),
    ("lsof", &[]),
    ("ss", &[]),
    ("netstat", &[]),
    ("df", &[]),
    ("du", &[]),
    ("free", &[]),
    ("vmstat", &[]),
    ("iostat", &[]),
    ("mpstat", &[]),
    ("sar", &[]),
    ("nproc", &[]),
    ("lsblk", &[]),
    ("lscpu", &[]),
    ("lsmod", &[]),
    ("lspci", &[]),
    ("lsusb", &[]),
    ("top", &["-bn1"]),
    ("stat", &[]),
    ("file", &[]),
    ("wc", &[]),
    ("uniq", &[]),
    ("grep", &[]),
    ("egrep", &[]),
    ("fgrep", &[]),
    ("head", &[]),
    ("tail", &[]),
    ("cat", &[]),
    ("sort", &[]),
    ("env", &[]),
    ("printenv", &[]),
    ("locale", &[]),
    ("which", &[]),
    ("whereis", &[]),
    ("journalctl", &[]),
    ("nginx", &["-t", "-v", "-V", "-h"]),
    ("apache2ctl", &["-t", "-v"]),
    ("httpd", &["-t", "-v"]),
    ("curl", &["-I", "-sI", "-i"]),
    ("ping", &["-c"]),
    ("dig", &[]),
    ("nslookup", &[]),
];

/// 只读服务查询类命令:第一个非参数标记的子命令必须命中安全集合。
const SERVICE_READ_SUBCOMMANDS: &[(&str, &[&str])] = &[
    (
        "systemctl",
        &[
            "status",
            "show",
            "is-active",
            "is-enabled",
            "is-failed",
            "cat",
            "list-units",
            "list-timers",
            "list-sockets",
            "list-jobs",
            "list-dependencies",
        ],
    ),
    ("service", &["status", "state"]),
    (
        "docker",
        &["ps", "images", "inspect", "version", "stats", "logs"],
    ),
    (
        "kubectl",
        &["get", "describe", "logs", "top", "version", "explain"],
    ),
    ("redis-cli", &["ping", "info", "dbsize"]),
];

/// 判断远端命令是否为只读取证。
///
/// 输入是 argv 数组(调用方必须在传输层按数组执行,禁止 shell 拼接,AGENTS.md §7)。
/// 采用"默认有害"策略:不在只读清单内、或参数里出现 shell 控制符、或属于解释器类
/// 二进制,一律判 [`ToolCategory::Mutating`]。
pub fn classify_command(argv: &[String]) -> CommandDecision {
    let Some(program) = argv.first().map(|value| value.trim()) else {
        return CommandDecision::new(ToolCategory::Mutating, "命令为空,按改动服务器处理");
    };
    let args = &argv[1..];

    if let Some(token) = find_control_token(program, args) {
        return CommandDecision::new(
            ToolCategory::Mutating,
            format!("命令包含 shell 控制符 {token},需人工确认"),
        );
    }
    if let Some(token) = find_denied_arg(args) {
        return CommandDecision::new(
            ToolCategory::Mutating,
            format!("参数 {token} 会写文件或改状态,需人工确认"),
        );
    }

    let bin = basename(program);
    if NEVER_READ_ONLY_BINS.contains(&bin) {
        return CommandDecision::new(
            ToolCategory::Mutating,
            format!("{bin} 可执行任意代码或外联,需人工确认"),
        );
    }

    if let Some((_, subs)) = SERVICE_READ_SUBCOMMANDS
        .iter()
        .find(|(name, _)| *name == bin)
    {
        return classify_with_subcommands(bin, args, subs);
    }

    for (name, guards) in READ_ONLY_COMMANDS {
        if *name != bin {
            continue;
        }
        // 带约束的条目(如 top 必须 -bn1):必须出现一个安全参数才认定为只读。
        if !guards.is_empty() && !args.iter().any(|arg| guards.contains(&arg.as_str())) {
            return CommandDecision::new(
                ToolCategory::Mutating,
                format!("{bin} 需带限定参数(可选:{})才是只读", guards.join(", ")),
            );
        }
        return CommandDecision::new(ToolCategory::ReadOnly, format!("{bin} 属于只读取证命令"));
    }

    CommandDecision::new(
        ToolCategory::Mutating,
        format!("{bin} 不在只读清单内,按改动服务器处理"),
    )
}

/// 判断读取远端文件的路径是否可用。
///
/// # Errors
/// 返回 `Err(原因)` 表示该路径被拒绝(非绝对路径、含 `..`、指向字符设备等)。
pub fn check_read_path(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".to_owned());
    }
    if !trimmed.starts_with('/') {
        return Err("只接受远端绝对路径".to_owned());
    }
    if trimmed.split('/').any(|segment| segment == "..") {
        return Err("路径包含 .. 上跳,拒绝".to_owned());
    }
    // 字符设备/特殊文件会让读取挂住或吐无限流。
    if trimmed.starts_with("/dev/") && trimmed != "/dev/null" {
        return Err("禁止读取 /dev 下的设备文件".to_owned());
    }
    Ok(())
}

/// 判断写入类路径是否可用(比读取更严:连 `/dev/null` 也不允许写)。
///
/// # Errors
/// 同 [`check_read_path`],另外拒绝写入系统目录之外的猜测路径由调用方结合远端事实决定。
pub fn check_write_path(path: &str) -> Result<(), String> {
    check_read_path(path)?;
    if path.trim() == "/dev/null" {
        return Err("写入请求不应指向设备文件".to_owned());
    }
    Ok(())
}

fn classify_with_subcommands(bin: &str, args: &[String], subs: &[&str]) -> CommandDecision {
    let first = args.iter().find(|arg| !arg.starts_with('-'));
    match first.map(String::as_str) {
        Some(sub) if subs.contains(&sub) => {
            CommandDecision::new(ToolCategory::ReadOnly, format!("{bin} {sub} 属于只读查询"))
        }
        Some(sub) => CommandDecision::new(
            ToolCategory::Mutating,
            format!("{bin} {sub} 不在只读子命令清单内"),
        ),
        None if subs.contains(&"") => {
            CommandDecision::new(ToolCategory::ReadOnly, format!("{bin} 无子命令时为只读"))
        }
        None => CommandDecision::new(
            ToolCategory::Mutating,
            format!("{bin} 缺少子命令,无法判定为只读"),
        ),
    }
}

/// 把 argv 组装成远端可执行命令字符串,并对每个参数做 POSIX 单引号转义。
///
/// 为什么必须转义:SSH `exec` 请求在服务端通常仍经 `$SHELL -c` 解释整条命令串,
/// 只在我们这一侧禁用控制符是不够的 —— 不转义等于把 shell 语义交回给远端(AGENTS.md §7)。
#[must_use]
pub fn quote_argv(argv: &[String]) -> String {
    argv.iter()
        .map(|argument| format!("'{}'", argument.replace('\'', "'\\''")))
        .collect::<Vec<String>>()
        .join(" ")
}

/// 找出参数里出现的第一个 shell 控制符(整词或包含均算)。
fn find_control_token(program: &str, args: &[String]) -> Option<&'static str> {
    let mut candidates = vec![program];
    candidates.extend(args.iter().map(String::as_str));
    SHELL_CONTROL_TOKENS
        .iter()
        .find(|token| candidates.iter().any(|arg| arg.contains(**token)))
        .copied()
}

/// 找出第一个"会写文件/改状态"的参数(整词匹配,避免把 `-o` 之外的正常参数误伤)。
fn find_denied_arg(args: &[String]) -> Option<&'static str> {
    args.iter()
        .find_map(|arg| DENY_ARG_TOKENS.iter().find(|token| *token == arg).copied())
}

/// 取路径最后一段作为可执行文件名。
fn basename(program: &str) -> &str {
    program
        .rsplit('/')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(program)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造 argv。
    fn argv(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    /// 只读清单内的命令判为只读。
    #[test]
    fn readonly_allowlist() {
        for cmd in [
            &["uptime"][..],
            &["df", "-h"][..],
            &["free", "-m"][..],
            &["systemctl", "status", "nginx"][..],
            &["journalctl", "-u", "nginx", "-n", "200"][..],
            &["tail", "-n", "200", "/var/log/nginx/access.log"][..],
            &["ss", "-lntp"][..],
            &["nginx", "-t"][..],
            &["docker", "ps"][..],
        ] {
            let decision = classify_command(&argv(cmd));
            assert!(
                decision.is_read_only(),
                "{cmd:?} 应为只读,实际:{:?}",
                decision.reason
            );
        }
    }

    /// 带约束的条目缺限定参数时按写处理。
    #[test]
    fn guarded_commands_need_their_guard_flag() {
        assert!(!classify_command(&argv(&["top"])).is_read_only());
        assert!(classify_command(&argv(&["top", "-bn1"])).is_read_only());
        assert!(!classify_command(&argv(&["nginx"])).is_read_only());
        assert!(classify_command(&argv(&["nginx", "-t"])).is_read_only());
        assert!(!classify_command(&argv(&["ping", "8.8.8.8"])).is_read_only());
        assert!(classify_command(&argv(&["ping", "-c", "3", "8.8.8.8"])).is_read_only());
    }

    /// 写文件类参数一律升级为写操作。
    #[test]
    fn output_flags_escalate() {
        assert_eq!(
            classify_command(&argv(&["sort", "-o", "/etc/passwd", "/tmp/a"])).category,
            ToolCategory::Mutating
        );
        assert_eq!(
            classify_command(&argv(&["grep", "-r", "x", "/data", "-fprint", "/tmp/o"])).category,
            ToolCategory::Mutating
        );
        // 常见的只读用法不受影响。
        assert!(classify_command(&argv(&["grep", "-i", "x", "/var/log/a"])).is_read_only());
    }

    /// shell 控制符一律升级为写操作。
    #[test]
    fn control_tokens_escalate_to_mutating() {
        for cmd in [
            &["uptime", ";", "rm", "-rf", "/"][..],
            &["cat", "/etc/passwd", "|", "sh"][..],
            &["grep", "-r", "x", "/data", ">", "/tmp/out"][..],
            &["echo", "$(curl evil)"][..],
            &["ls", "-l", "`id`"][..],
        ] {
            let decision = classify_command(&argv(cmd));
            assert_eq!(decision.category, ToolCategory::Mutating, "{cmd:?}");
        }
    }

    /// 解释器类二进制即使参数无害也按写处理。
    #[test]
    fn interpreters_are_never_read_only() {
        for bin in [
            "sh", "bash", "python3", "perl", "node", "sudo", "xargs", "ssh",
        ] {
            let decision = classify_command(&argv(&[bin, "-c", "echo hi"]));
            assert_eq!(decision.category, ToolCategory::Mutating, "{bin}");
        }
    }

    /// 不在清单内的命令默认按写处理(默认有害)。
    #[test]
    fn unknown_commands_are_mutating() {
        for cmd in [
            &["systemctl", "restart", "nginx"][..],
            &["rm", "-rf", "/tmp/x"][..],
            &["kill", "1234"][..],
            &["apt", "install", "curl"][..],
            &["mv", "/a", "/b"][..],
            &["", ""],
        ] {
            assert_eq!(
                classify_command(&argv(cmd)).category,
                ToolCategory::Mutating,
                "{cmd:?}"
            );
        }
    }

    /// 服务类命令的只读子命令白名单生效。
    #[test]
    fn service_subcommands_gate_read_only() {
        assert!(classify_command(&argv(&["systemctl", "show", "nginx"])).is_read_only());
        assert_eq!(
            classify_command(&argv(&["systemctl", "stop", "nginx"])).category,
            ToolCategory::Mutating
        );
        assert_eq!(
            classify_command(&argv(&["systemctl"])).category,
            ToolCategory::Mutating
        );
    }

    /// 带路径的可执行名按 basename 判定。
    #[test]
    fn absolute_program_path_is_reduced_to_basename() {
        assert!(classify_command(&argv(&["/usr/bin/uptime"])).is_read_only());
        assert!(classify_command(&argv(&["/bin/systemctl", "status", "ssh"])).is_read_only());
    }

    /// 只读路径校验:必须绝对、不含 ..、不读设备文件。
    #[test]
    fn read_path_rules() {
        assert!(check_read_path("/var/log/a.log").is_ok());
        assert!(check_read_path("/dev/null").is_ok());
        assert!(check_read_path("relative/path").is_err());
        assert!(check_read_path("/var/../etc/passwd").is_err());
        assert!(check_read_path("/dev/zero").is_err());
        assert!(check_read_path("   ").is_err());
        assert!(check_write_path("/dev/null").is_err());
        assert!(check_write_path("/etc/hosts").is_ok());
    }

    /// 类别字面量稳定(进契约与前端文案映射)。
    #[test]
    fn category_wire_literals_are_stable() {
        assert_eq!(
            serde_json::to_value(ToolCategory::ReadOnly).unwrap(),
            "read_only"
        );
        assert_eq!(
            serde_json::to_value(ToolCategory::Mutating).unwrap(),
            "mutating"
        );
        assert_eq!(ToolCategory::Connect.as_str(), "connect");
    }

    /// argv 组装把 shell 语义彻底锁死(含单引号与分号的参数只能当字面量)。
    #[test]
    fn argv_is_shell_quoted_when_composed() {
        let command = quote_argv(&argv(&["sh", "-c", "rm -rf /; echo hi"]));
        assert_eq!(command, "'sh' '-c' 'rm -rf /; echo hi'");
        // 参数内含单引号按 POSIX 方式断开重接,不会被吞成字符串边界。
        assert_eq!(quote_argv(&argv(&["it's"])), "'it'\\''s'");
    }
}
