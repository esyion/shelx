-- M5 追加:每一轮的"过程"进入耐久投影。
-- 背景:0002 的 agent_messages 只有 role + content,思考与工具步骤只活在事件流里,
-- 重开线程就什么都不剩;界面因此必须判断"这一份回答由历史还是由时间线呈现",
-- 而两份投影之间没有共同身份可对齐,只能按位置猜(AGENTS.md §5 契约单点定义)。
-- 现在把一轮已发布的事件按 seq 存下来,快照原样带回,前端用同一个归并器还原时间线:
-- 渲染只有一条来源,去重判断整块失去存在理由。历史行保持 NULL,界面按"无过程"如实留空。
ALTER TABLE agent_runs ADD COLUMN timeline TEXT;

PRAGMA user_version = 4;
