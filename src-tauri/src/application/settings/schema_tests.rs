/**
 * 设置项契约 schema 的单元测试(由 schema.rs 拆出,保持单文件体量可控):
 * 契约覆盖性、默认值同源、档位合法性、越界拒绝、契约外字段拒绝、脱敏回显。
 */
use super::*;
use serde_json::json;

/// 收集序列化树里的全部叶子路径。
fn collect_leaves(value: &Value, prefix: &str, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                collect_leaves(child, &path, out);
            }
        }
        _ => out.push(prefix.to_owned()),
    }
}

/// 登记表必须与真实契约双向一致:新增字段忘记登记、或登记了不存在的字段,都要失败。
#[test]
fn schema_matches_contract_fields_both_directions() {
    let tree = serde_json::to_value(AppSettings::default()).unwrap();
    let mut leaves = Vec::new();
    collect_leaves(&tree, "", &mut leaves);
    let registered = schema_paths();
    let unregistered: Vec<_> = leaves
        .iter()
        .filter(|leaf| !registered.contains(leaf))
        .cloned()
        .collect();
    assert!(
        unregistered.is_empty(),
        "以下设置项未登记 schema: {unregistered:?}"
    );
    let ghost: Vec<_> = registered
        .iter()
        .filter(|path| pick(&tree, path).is_none())
        .cloned()
        .collect();
    assert!(
        ghost.is_empty(),
        "schema 登记了契约中不存在的路径: {ghost:?}"
    );
}

/// 默认值必须来自真实契约,不能在登记表里写死。
#[test]
fn schema_defaults_match_serialized_defaults() {
    let tree = serde_json::to_value(AppSettings::default()).unwrap();
    for spec in settings_schema() {
        assert_eq!(
            scalar_of(pick(&tree, &spec.path)),
            spec.default,
            "{} 的默认值漂移",
            spec.path
        );
    }
}

/// 整数档位必须落在自身区间内,否则界面会渲染出注定被拒的选项。
#[test]
fn int_presets_are_inside_ranges() {
    for raw in raw_specs() {
        if let SettingKind::Int { min, max, presets } = &raw.kind {
            for preset in presets {
                assert!(
                    preset >= min && preset <= max,
                    "{} 档位 {preset} 越界",
                    raw.path
                );
            }
        }
    }
}

/// 默认全量设置必须通过 schema 校验。
#[test]
fn default_settings_pass_validation() {
    let tree = serde_json::to_value(AppSettings::default()).unwrap();
    assert_eq!(validate_values(&tree), SchemaCheck::Ok);
}

/// 越界值被拒,并带上路径/区间/单位(前端据此定位控件)。
#[test]
fn out_of_range_reports_path_and_bounds() {
    let tree = json!({ "transfer": { "chunkSizeKib": 4096 } });
    let SchemaCheck::Violations(violations) = validate_values(&tree) else {
        panic!("应报违规");
    };
    // 局部树缺字段本身也是违规,这里断言目标项的详情结构。
    let first = violations
        .iter()
        .find(|v| v.path == "transfer.chunkSizeKib")
        .expect("应报分块大小越界");
    assert_eq!(first.min, Some(4.0));
    assert_eq!(first.max, Some(1024.0));
    assert_eq!(first.unit.as_deref(), Some("KiB"));
    assert_eq!(first.received, SettingScalar::Number(4096.0));
}

/// 完整设置树只报真正的越界项(缺字段检测只在局部树上出现)。
#[test]
fn full_tree_violation_lists_only_out_of_range() {
    let mut settings = AppSettings::default();
    settings.transfer.chunk_size_kib = 4096;
    let tree = serde_json::to_value(&settings).unwrap();
    let SchemaCheck::Violations(violations) = validate_values(&tree) else {
        panic!("应报越界");
    };
    assert_eq!(violations.len(), 1);
    assert_eq!(violations[0].path, "transfer.chunkSizeKib");
    assert_eq!(
        violation_message(&violations),
        "transfer.chunkSizeKib 必须在 4–1024 KiB 之间"
    );
}

/// 契约外的字段名必须被拒(本次缺陷本体:前端写 `chunkSizeKiB` 被静默丢弃)。
#[test]
fn patch_with_unknown_field_is_rejected() {
    let check = validate_patch(&json!({ "transfer": { "chunkSizeKiB": 64 } }));
    let SchemaCheck::UnknownPaths(paths) = check else {
        panic!("未知字段必须被拒,实际 {check:?}");
    };
    assert_eq!(paths, vec!["transfer.chunkSizeKiB".to_owned()]);
    assert_eq!(
        unknown_paths_message(&paths),
        "设置项不存在:transfer.chunkSizeKiB"
    );
}

/// 合法补丁通过;枚举候选写错被拒。
#[test]
fn patch_checks_enum_options() {
    assert_eq!(
        validate_patch(&json!({ "appearance": { "theme": "dark" } })),
        SchemaCheck::Ok
    );
    assert!(matches!(
        validate_patch(&json!({ "appearance": { "theme": "midnight" } })),
        SchemaCheck::Violations(_)
    ));
}

/// 内部维护项允许非标量形态(迁移标记写 null)。
#[test]
fn hidden_fields_accept_internal_values() {
    assert_eq!(
        validate_patch(&json!({ "migration": { "pendingMigrationId": null } })),
        SchemaCheck::Ok
    );
}

/// 自由文本超长被拒,且不回显内容。
#[test]
fn text_length_is_bounded_and_value_redacted() {
    let long = "x".repeat(300);
    let check = validate_patch(&json!({ "terminal": { "fontFamily": long } }));
    let SchemaCheck::Violations(violations) = check else {
        panic!("超长字体名应被拒,实际 {check:?}");
    };
    assert!(
        matches!(&violations[0].received, SettingScalar::Text(text) if text.contains("长度 300")),
        "超长文本必须脱敏为长度说明,实际 {:?}",
        violations[0].received
    );
}

/// 布尔项收到字符串要被拒(补丁直接透传 JSON 的场景)。
#[test]
fn bool_rejects_non_boolean() {
    assert!(matches!(
        validate_patch(&json!({ "update": { "autoCheck": "true" } })),
        SchemaCheck::Violations(_)
    ));
}

/// 浮点区间:行距 0.8 越界,1.2 合法。
#[test]
fn float_range_is_enforced() {
    assert!(matches!(
        validate_patch(&json!({ "terminal": { "lineHeight": 0.8 } })),
        SchemaCheck::Violations(_)
    ));
    assert_eq!(
        validate_patch(&json!({ "terminal": { "lineHeight": 1.2 } })),
        SchemaCheck::Ok
    );
}

/// 契约 fixture 与前端生成物同源:导出模式写文件,默认模式校验未过期。
#[test]
fn settings_contract_fixture_is_up_to_date() {
    let fixture_path = fixture_path();
    let payload = serde_json::to_string_pretty(&json!({
        "schema": settings_schema(),
        "defaults": serde_json::to_value(AppSettings::default()).unwrap(),
    }))
    .unwrap();
    if std::env::var("SHELX_UPDATE_CONTRACT").is_ok() {
        std::fs::create_dir_all(fixture_path.parent().unwrap()).unwrap();
        std::fs::write(&fixture_path, format!("{payload}\n")).unwrap();
        return;
    }
    let on_disk = std::fs::read_to_string(&fixture_path)
            .unwrap_or_else(|_| panic!("缺少契约 fixture,请运行 cargo test settings_contract_fixture -- --exact 前设置 SHELX_UPDATE_CONTRACT=1,再 bun run gen:ipc"));
    let normalized: serde_json::Value = serde_json::from_str(&on_disk).unwrap();
    let expected: serde_json::Value = serde_json::from_str(&payload).unwrap();
    assert_eq!(normalized, expected, "设置契约 fixture 已过期");
}

/// fixture 路径(仓库内,前端 codegen 读取)。
fn fixture_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("contract/settings-contract.json")
}
