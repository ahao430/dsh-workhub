/**
 * Watchdog — deterministic rule engine that detects work-state findings and
 * stores them as rule-origin insights (kind 'insight', payload.origin 'rule').
 * No LLM here: every finding is computed from SQL-verified facts, matching the
 * v2 principle that statistics and AI insight stay separated. Rule findings
 * dedupe by title within 24h.
 */

const DAY = 86_400_000

export class Watchdog {
  constructor(db) {
    this.db = db
  }

  /** Run all rules; returns newly created findings. */
  run(authHealth = null) {
    const findings = [
      ...this.authExpired(authHealth),
      ...this.overdueTodos(),
      ...this.dormantProjects(),
      ...this.discussionWithoutTasks(),
      ...this.syncFailures(),
    ]
    const recent = this.db.listAnalyses({ kind: 'insight', limit: 100 })
    const created = []
    for (const f of findings) {
      const dup = recent.find(
        (a) => a.payload?.origin === 'rule' && a.payload?.title === f.title
          && Date.now() - new Date(a.generatedAt).getTime() < DAY,
      )
      if (dup) continue
      created.push(
        this.db.saveAnalysis({
          kind: 'insight',
          scope: { rule: f.rule, projectId: f.projectId ?? null },
          payload: { ...f, origin: 'rule' },
          sources: f.sources,
          model: 'rule-engine',
        }),
      )
    }
    return created
  }

  /* R0: DingTalk login expired (needs re-login, not self-healing) */
  authExpired(authHealth) {
    if (!authHealth) return []
    const refreshOk = authHealth.refreshTokenValid !== false
    if (refreshOk) return []
    return [{
      rule: 'auth_expired',
      title: '钉钉登录已失效，需要重新登录',
      description: 'refresh token 已过期或被撤销，DWS 无法自动续期。请在终端执行 `dws auth login` 完成扫码登录，登录后同步会自动恢复（历史数据不受影响）。',
      importance: 'high',
      sources: [],
    }]
  }

  /* R1: overdue open todos */
  overdueTodos() {
    const todos = this.db.listWorkItems({ sourceType: 'todo', limit: 200 })
    const now = Date.now()
    const overdue = todos.filter((t) => {
      if (!t.occurred_at || t.occurred_at.startsWith(new Date().toISOString().slice(0, 10))) return false
      // done todos have occurred_at == dueTime too; rely on raw stage in content? raw not selected.
      return new Date(t.occurred_at).getTime() < now - DAY
    })
    if (!overdue.length) return []
    return [{
      rule: 'overdue_todos',
      title: `有 ${overdue.length} 条待办已过截止时间`,
      description: `最近同步的待办中，${overdue.length} 条的截止时间早于昨天。建议在钉钉待办中核实状态（可能已完成但未更新）。涉及：${overdue.slice(0, 3).map((t) => t.title || t.source_id).join('；')}${overdue.length > 3 ? ' 等' : ''}。`,
      importance: overdue.length >= 5 ? 'high' : 'medium',
      sources: overdue.slice(0, 20).map((t) => ({
        sourceType: 'todo', sourceId: t.source_id, itemId: t.id, title: t.title, timestamp: t.occurred_at,
      })),
    }]
  }

  /* R2: project dormancy — active in 90d but silent for 14d */
  dormantProjects() {
    const out = []
    for (const p of this.db.listProjects()) {
      const input = this.db.projectAnalysisInput(p.id, 90)
      if (!input.stats.total) continue
      const last = input.sources
        .map((s) => s.timestamp)
        .sort()
        .pop()
      const silentDays = last ? Math.floor((Date.now() - new Date(last).getTime()) / DAY) : null
      if (silentDays !== null && silentDays >= 14) {
        out.push({
          rule: 'dormant_project',
          projectId: p.id,
          title: `项目「${p.name}」已 ${silentDays} 天无关联工作记录`,
          description: `该项目近 90 天有 ${input.stats.total} 条关联记录，但最近一次是 ${last?.slice(0, 10)}。可能已收尾，或需要确认是否停滞。`,
          importance: silentDays >= 30 ? 'medium' : 'low',
          sources: input.sources.slice(0, 5),
        })
      }
    }
    return out
  }

  /* R3: heavy discussion without any linked todo */
  discussionWithoutTasks() {
    const out = []
    for (const p of this.db.listProjects()) {
      const activity = this.db.projectActivityRange(
        isoDaysAgo(30), isoDaysAgo(0),
      ).filter((r) => r.id === p.id)
      const chats = activity.filter((r) => r.source_type === 'chat_message').reduce((a, r) => a + r.n, 0)
      const todos = activity.filter((r) => r.source_type === 'todo').reduce((a, r) => a + r.n, 0)
      if (chats >= 20 && todos === 0) {
        const input = this.db.projectAnalysisInput(p.id, 30)
        out.push({
          rule: 'discussion_without_tasks',
          projectId: p.id,
          title: `项目「${p.name}」近 30 天讨论活跃（${chats} 条消息）但无关联待办`,
          description: '大量讨论未沉淀为任务，建议确认是否需要创建待办跟进。',
          importance: 'medium',
          sources: input.sources.slice(0, 10),
        })
      }
    }
    return out
  }

  /* R4: data source failures */
  syncFailures() {
    const failed = this.db.listSyncState().filter((s) => s.status === 'error')
    if (!failed.length) return []
    return [{
      rule: 'sync_failure',
      title: `${failed.length} 个数据源同步失败`,
      description: failed.map((s) => `${s.source}: ${s.last_error ?? ''}`.slice(0, 120)).join('；'),
      importance: 'medium',
      sources: [],
    }]
  }
}

function isoDaysAgo(n) {
  const d = new Date(Date.now() - n * DAY)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
