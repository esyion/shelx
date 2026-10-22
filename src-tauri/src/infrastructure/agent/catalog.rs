//! 模型目录查询:上下文窗口与回复上限的唯一来源(防腐层第三处)。
//!
//! rig 随包带了一份 models.dev 的目录(`rig::catalog::Catalog::builtin`),里面就有每个
//! 模型的 `context_window` / `max_output_tokens`。上层因此不需要自己记"某模型多大窗口",
//! 界面也不许硬编码档位(AGENTS.md §5 契约单点定义)。查不到就返回 `None` —— 窗口未知时
//! 界面如实留空,不拿一个猜的数当分母。

use rig::catalog::Catalog;

use crate::domain::agent::ModelWindow;

/// 按模型名查目录里的窗口事实。
///
/// 匹配口径:模型 id 大小写不敏感的精确匹配。多家厂商列了同名模型时取第一个给了窗口的 ——
/// 自定义网关常把别家的模型挂在自己名下,窗口照抄被代理的那个模型。
pub fn lookup_window(model: &str) -> Option<ModelWindow> {
    let needle = model.trim().to_lowercase();
    if needle.is_empty() {
        return None;
    }
    let matched: Vec<_> = Catalog::builtin()
        .iter()
        .filter(|spec| spec.id.to_lowercase() == needle)
        .collect();
    let spec = matched
        .iter()
        .find(|spec| spec.context_window.is_some())
        .or(matched.first())?;
    Some(ModelWindow {
        display_name: spec.display_name.clone(),
        context_window: spec.context_window,
        max_output_tokens: spec.max_output_tokens,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 目录里已收录的模型能查出窗口 —— 这是"分母不必让用户填"的前提。
    #[test]
    fn known_model_reports_a_window() {
        let facts = lookup_window("glm-5.3").expect("随包目录应收录该模型");
        assert!(
            facts.context_window.unwrap_or_default() > 0,
            "窗口必须是正数,拿到 0/None 说明目录读取退化了"
        );
    }

    /// 大小写与首尾空白不影响命中(用户手打的模型名各种写法都有)。
    #[test]
    fn lookup_ignores_case_and_padding() {
        assert_eq!(
            lookup_window("  GLM-5.3 "),
            lookup_window("glm-5.3"),
            "同一模型的两种写法必须给同一条目录记录"
        );
    }

    /// 查不到的模型如实返回 None,不伪造分母。
    #[test]
    fn unknown_model_has_no_window() {
        assert!(lookup_window("not-a-real-model-xyz").is_none());
        assert!(lookup_window("   ").is_none());
    }
}
