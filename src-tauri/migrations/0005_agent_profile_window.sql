-- M6 追加:上下文窗口是"模型的事实",不是"对话的预算"。
-- 背景:界面用量条拿 `agent.tokenBudget`(后端 check_budget 真正拦的那个钱袋子)当分母,
-- 于是 1M 窗口的 glm-5.3 显示成"20 万已满"。窗口大小 rig 随包的目录里就有
-- (rig-core/src/catalog/models.json),应由接入点带出、允许覆盖,不该记在对话设置里。
-- 两列都允许 NULL 表示"用户没覆盖",运行时回落到目录值;不给默认值,免得把
-- "填了 0"和"没填"混成同一件事(AGENTS.md §5 契约单点定义)。
ALTER TABLE agent_profiles ADD COLUMN context_window INTEGER;
ALTER TABLE agent_profiles ADD COLUMN max_output_tokens INTEGER;

PRAGMA user_version = 5;
