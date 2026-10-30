//! 本机工作区领域规则:路径 confinement(词法层)与登记校验(AGENTS.md §4.4,纯 Rust)。
//!
//! 词法层只做快失败与友好报错;真正的安全闸在基础设施层 —— canonicalize 之后用
//! [`is_within`] 做组件级前缀复核(符号链接在那一步被解析,链到根外即拒)。
//! 两层缺一不可:词法层挡住 `..` 与根外绝对路径,canonical 层挡住符号链接逃逸。

use super::AgentDomainError;

/// 本机工具在审批、审计与事件里共用的稳定目标标识(前端映射同一字面量)。
pub const LOCAL_TARGET_ID: &str = "local";

/// 工作区名称上限(字符数,与线程标题一致)。
pub const WORKSPACE_NAME_MAX: usize = 80;
/// 工作区根路径存储长度上限(字符数)。
pub const WORKSPACE_PATH_MAX: usize = 1024;

/// 工作区路径的词法错误。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WorkspacePathError {
    /// 路径为空。
    #[error("路径不能为空")]
    Empty,
    /// 包含 `..` 组件,拒绝上跳。
    #[error("路径包含 .. 上跳,拒绝")]
    ParentHop,
    /// 落在工作区根之外。
    #[error("只接受工作区内的路径")]
    OutsideRoot,
    /// 形态非法(盘符相对路径、非法字符等)。
    #[error("路径形态非法")]
    Invalid,
}

/// 路径的词法前缀形态(决定"绝对"的家族)。
#[derive(Debug, Clone, PartialEq, Eq)]
enum Prefix {
    /// 相对路径,无前缀。
    None,
    /// Unix 根,`/` 开头。
    Root,
    /// Windows 盘符绝对路径,如 `C:\x`(内部为大写 `C:`)。
    Drive(String),
    /// UNC,`\\server\share\x`(含 `\\?\UNC\server\share` 规范形态)。
    Unc,
}

/// 解析路径:剥 `\\?\` 前缀、识别前缀家族、按两种分隔符拆组件。
/// 空组件与 `.` 折叠掉;`..` 保留(由调用方决定拒绝与否)。
fn parse(path: &str) -> Result<(Prefix, Vec<String>), WorkspacePathError> {
    if path.contains('\0') {
        return Err(WorkspacePathError::Invalid);
    }
    let mut rest = path;
    let mut prefix = Prefix::None;
    let mut unc = false;
    if let Some(stripped) = rest.strip_prefix(r"\\?\UNC\") {
        rest = stripped;
        unc = true;
    } else if let Some(stripped) = rest.strip_prefix(r"\\?\") {
        rest = stripped;
        // `\\?\C:\x` 归盘符家族;`\\?\UNC\...` 已在上面处理。
    } else if rest.starts_with(r"\\") {
        rest = &rest[2..];
        unc = true;
    }
    if unc {
        prefix = Prefix::Unc;
    } else if rest.len() >= 2 {
        let bytes = rest.as_bytes();
        let maybe_drive = bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
        if maybe_drive {
            let drive = format!("{}:", bytes[0].to_ascii_uppercase() as char);
            if rest.len() == 2 {
                // 裸盘符 `C:` 指向"该盘当前目录",拒绝。
                return Err(WorkspacePathError::Invalid);
            }
            if bytes[2] != b'/' && bytes[2] != b'\\' {
                // 盘符相对 `C:foo` 同样指向"该盘当前目录",拒绝。
                return Err(WorkspacePathError::Invalid);
            }
            prefix = Prefix::Drive(drive);
            rest = &rest[3..];
        } else if rest.starts_with('/') {
            prefix = Prefix::Root;
            rest = &rest[1..];
        }
    } else if rest.starts_with('/') {
        prefix = Prefix::Root;
        rest = &rest[1..];
    }
    let components = rest
        .split(['/', '\\'])
        .filter(|part| !part.is_empty() && *part != ".")
        .map(ToOwned::to_owned)
        .collect();
    Ok((prefix, components))
}

/// 组件相等比较:Windows 家族(盘符/UNC)大小写不敏感,Unix 精确比较。
fn component_eq(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

/// 两个前缀是否同一"绝对家族"(都为根/都为同盘符/都为 UNC)。
fn same_family(root: &Prefix, candidate: &Prefix) -> bool {
    match (root, candidate) {
        (Prefix::Root, Prefix::Root) | (Prefix::Unc, Prefix::Unc) => true,
        (Prefix::Drive(a), Prefix::Drive(b)) => a.eq_ignore_ascii_case(b),
        _ => false,
    }
}

/// `candidate` 的组件序列是否以 `root` 的组件序列为前缀。
fn starts_with_components(root: &[String], candidate: &[String]) -> bool {
    candidate.len() >= root.len() && root.iter().zip(candidate).all(|(a, b)| component_eq(a, b))
}

/// 把前缀与组件重组为路径字符串(平台分隔符)。
fn rebuild(prefix: &Prefix, components: &[String]) -> String {
    let joined = components.join(std::path::MAIN_SEPARATOR_STR);
    match prefix {
        Prefix::None => joined,
        Prefix::Root => format!("/{joined}"),
        Prefix::Drive(drive) => {
            if components.is_empty() {
                format!("{drive}{}", std::path::MAIN_SEPARATOR)
            } else {
                format!("{drive}{}{joined}", std::path::MAIN_SEPARATOR)
            }
        }
        Prefix::Unc => format!(r"\\{joined}"),
    }
}

/// 词法归一:把请求路径解析到工作区根之内。
///
/// 规则:空拒绝;`..` 组件拒绝;`.` 与重复分隔符折叠;`\` `/` 都按分隔符;相对路径
/// 拼到根下;绝对路径必须与根同家族且组件以根为前缀,否则 [`WorkspacePathError::OutsideRoot`]。
/// 拒绝盘符相对形态(`C:foo`、裸 `C:`)。返回词法归一后的绝对路径(不校验存在性 ——
/// canonicalize 属基础设施层职责)。
///
/// # Errors
/// 见 [`WorkspacePathError`] 各变体;`root` 自身形态非法时返回 [`WorkspacePathError::Invalid`]。
pub fn normalize_within(root: &str, requested: &str) -> Result<String, WorkspacePathError> {
    if requested.trim().is_empty() {
        return Err(WorkspacePathError::Empty);
    }
    let (root_prefix, root_components) = parse(root)?;
    if root_prefix == Prefix::None {
        return Err(WorkspacePathError::Invalid);
    }
    let (req_prefix, req_components) = parse(requested)?;
    if req_components.iter().any(|part| part == "..") {
        return Err(WorkspacePathError::ParentHop);
    }
    let components = if req_prefix == Prefix::None {
        let mut merged = root_components.clone();
        merged.extend(req_components);
        merged
    } else {
        if !same_family(&root_prefix, &req_prefix)
            || !starts_with_components(&root_components, &req_components)
        {
            return Err(WorkspacePathError::OutsideRoot);
        }
        req_components
    };
    Ok(rebuild(&root_prefix, &components))
}

/// 组件级前缀判断:对两个**已 canonicalize** 的路径使用,`candidate` 是否落在 `root` 之内。
/// 这是 confinement 的安全闸;解析失败一律按"不在根内"处理(保守拒绝)。
#[must_use]
pub fn is_within(root_canonical: &str, candidate_canonical: &str) -> bool {
    let Ok((root_prefix, root_components)) = parse(root_canonical) else {
        return false;
    };
    let Ok((cand_prefix, cand_components)) = parse(candidate_canonical) else {
        return false;
    };
    root_prefix != Prefix::None
        && same_family(&root_prefix, &cand_prefix)
        && starts_with_components(&root_components, &cand_components)
}

/// 工作区登记校验:名称非空且 ≤[`WORKSPACE_NAME_MAX`] 字符;根路径非空、
/// ≤[`WORKSPACE_PATH_MAX`] 字符、无 NUL、形态为绝对路径。名称为空时由调用方
/// 先行兜底(取目录名),这里只拒绝非法。
///
/// # Errors
/// 名称空白 → [`AgentDomainError::EmptyName`];其它违规 → [`AgentDomainError::WorkspacePath`]。
pub fn validate_workspace(name: &str, root: &str) -> Result<(), AgentDomainError> {
    if name.trim().is_empty() {
        return Err(AgentDomainError::EmptyName);
    }
    if name.chars().count() > WORKSPACE_NAME_MAX {
        return Err(AgentDomainError::WorkspacePath(format!(
            "工作区名称超过 {WORKSPACE_NAME_MAX} 字"
        )));
    }
    if root.trim().is_empty() {
        return Err(AgentDomainError::WorkspacePath(
            "工作区根路径不能为空".into(),
        ));
    }
    if root.chars().count() > WORKSPACE_PATH_MAX {
        return Err(AgentDomainError::WorkspacePath(format!(
            "工作区根路径超过 {WORKSPACE_PATH_MAX} 字"
        )));
    }
    if root.contains('\0') || parse(root).map(|(p, _)| p == Prefix::None).unwrap_or(true) {
        return Err(AgentDomainError::WorkspacePath(
            "工作区根必须是绝对路径".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOT: &str = r"C:\ws";

    #[test]
    fn parent_hop_rejected() {
        assert_eq!(
            normalize_within(ROOT, "a/../b").unwrap_err(),
            WorkspacePathError::ParentHop
        );
        assert_eq!(
            normalize_within(ROOT, r"..\x").unwrap_err(),
            WorkspacePathError::ParentHop
        );
    }

    #[test]
    fn outside_root_rejected() {
        assert_eq!(
            normalize_within(ROOT, r"D:\other").unwrap_err(),
            WorkspacePathError::OutsideRoot
        );
        assert_eq!(
            normalize_within(ROOT, r"\\server\share\x").unwrap_err(),
            WorkspacePathError::OutsideRoot
        );
        assert_eq!(
            normalize_within(ROOT, r"C:\ws2\side").unwrap_err(),
            WorkspacePathError::OutsideRoot
        );
    }

    #[test]
    fn drive_relative_forms_rejected() {
        assert_eq!(
            normalize_within(ROOT, "C:foo").unwrap_err(),
            WorkspacePathError::Invalid
        );
        assert_eq!(
            normalize_within(ROOT, "C:").unwrap_err(),
            WorkspacePathError::Invalid
        );
    }

    #[test]
    fn nul_rejected() {
        assert_eq!(
            normalize_within(ROOT, "a\0b").unwrap_err(),
            WorkspacePathError::Invalid
        );
    }

    #[test]
    fn canonical_prefix_forms_are_recognized() {
        // \\?\ 前缀的规范形态与普通形态视为同一家族。
        assert!(normalize_within(r"\\?\C:\ws", r"C:\ws\a").is_ok());
        assert!(normalize_within(r"\\?\C:\ws", r"\\?\C:\ws\a").is_ok());
    }

    #[test]
    fn is_within_is_component_wise() {
        assert!(is_within(r"\\?\C:\ws", r"\\?\C:\ws\a\b.txt"));
        assert!(!is_within(r"\\?\C:\ws", r"\\?\C:\ws2\b.txt"));
        assert!(!is_within(r"\\?\C:\ws", r"\\?\D:\ws\b.txt"));
        assert!(!is_within(r"C:\ws", "a/b"));
    }

    #[cfg(windows)]
    #[test]
    fn is_within_case_insensitive_on_windows() {
        assert!(is_within(r"\\?\C:\WS", r"\\?\c:\ws\A.txt"));
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_paths_supported() {
        assert_eq!(
            normalize_within("/srv/ws", "a/b.txt").unwrap(),
            "/srv/ws/a/b.txt"
        );
        assert_eq!(
            normalize_within("/srv/ws", "/etc/passwd").unwrap_err(),
            WorkspacePathError::OutsideRoot
        );
        assert!(is_within(r"/srv/ws", r"/srv/ws/a"));
        assert!(!is_within(r"/srv/ws", r"/srv/ws2"));
    }

    #[test]
    fn validate_workspace_bounds() {
        assert!(validate_workspace("我的项目", r"C:\ws").is_ok());
        assert_eq!(
            validate_workspace("  ", r"C:\ws").unwrap_err(),
            AgentDomainError::EmptyName
        );
        assert!(validate_workspace(&"长".repeat(WORKSPACE_NAME_MAX + 1), r"C:\ws").is_err());
        assert!(validate_workspace("名", "").is_err());
        assert!(validate_workspace("名", &"x".repeat(WORKSPACE_PATH_MAX + 1)).is_err());
        assert!(validate_workspace("名", "relative/path").is_err());
    }
}
