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
