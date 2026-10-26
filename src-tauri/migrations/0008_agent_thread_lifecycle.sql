-- 0008_agent_thread_lifecycle: 线程生命周期(未发送/对话/已归档)与单一草稿不变量
-- 背景:「新对话」连点会在库里留下一批零消息空线程;本迁移清掉它们,
-- 并给线程加上显式生命周期列,草稿由部分唯一索引在全库层面限为至多一条。
-- 时间戳统一 INTEGER(unix 毫秒);所有 ID 为 TEXT(AGENTS.md §5)。
PRAGMA foreign_keys = ON;

-- 1) 清掉历史 bug 遗留的零消息空线程:零消息 ⇔ 零运行 ⇔ 零审计,删除无数据损失;
--    消息/运行/审计/rig 日志随外键级联清理。升级瞬间无人正在打字,不留"幽灵草稿"。
DELETE FROM agent_threads
 WHERE NOT EXISTS (SELECT 1 FROM agent_messages m WHERE m.thread_id = agent_threads.id);

-- 2) 既有欠账:agent_approvals 自 0002 起就没有指向 agent_threads 的外键,
--    删除线程后批准决策会孤儿残留;先清存量孤儿,代码侧 delete_thread 也补删,
--    让「彻底删除、无法恢复」的界面承诺与真实行为一致(AGENTS.md §4.1.1)。
DELETE FROM agent_approvals
 WHERE thread_id NOT IN (SELECT id FROM agent_threads);

-- 3) 生命周期列:存量非空线程全部是对话;归档时间戳有值的如实转归档。
ALTER TABLE agent_threads ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'
  CHECK(lifecycle IN ('draft','active','archived'));
UPDATE agent_threads SET lifecycle = 'archived' WHERE archived_at IS NOT NULL;

-- 4) 单一草稿不变量的物理层:任何写入路径插第二个草稿都会被 SQLite 拒绝。
CREATE UNIQUE INDEX idx_agent_threads_one_draft
  ON agent_threads(lifecycle) WHERE lifecycle = 'draft';

PRAGMA user_version = 8;
