-- M5 追加:审计行补齐"做了什么"的三个事实(入参、输出摘要、耗时)。
-- 背景:0002 建的表只存了 status/approval,args_json 一直被写成空串,输出与耗时根本没落库,
-- 界面的工具轨迹行只能显示"执行过"而显示不出命令与结果(AGENTS.md §4.1.1 不许伪造/不许吞信息)。
-- 历史行保持 NULL,界面按"无信息"留空而不是回填假值。
ALTER TABLE agent_tool_calls ADD COLUMN output_excerpt TEXT;
ALTER TABLE agent_tool_calls ADD COLUMN duration_ms INTEGER;

PRAGMA user_version = 3;
