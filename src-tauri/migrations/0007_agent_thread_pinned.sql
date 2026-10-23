-- 0007:对话置顶。agent_threads 增加 pinned_at(unix 毫秒;NULL = 未置顶)。
-- 列表排序变为:置顶在前(按置顶时间倒序),其余按更新时间倒序。
-- 加列即可,存量行取 NULL(未置顶),无需搬表。
ALTER TABLE agent_threads ADD COLUMN pinned_at INTEGER;

PRAGMA user_version = 7;
