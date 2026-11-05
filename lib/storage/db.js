/**
 * WorkHub storage — node:sqlite (built into the DSH Host Node runtime,
 * verified by M0 probe). Driver is experimental, so all SQL lives behind
 * this module to allow swapping to better-sqlite3 later.
 */
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

/** 需求号提取：标题前缀形如 ZTPRO-924 / MOPRO-1992。 */
const REQ_RE = /\b([A-Z]{2,6}PRO-\d+)\b/
const MIGRATIONS = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS sync_state (
  source TEXT PRIMARY KEY,
  cursor TEXT,
  last_sync_at TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  total_synced INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT,
  content TEXT,
  actor TEXT,
  occurred_at TEXT NOT NULL,
  chat_id TEXT,
  raw_json TEXT,
  fetched_at TEXT NOT NULL,
  UNIQUE(source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_items_occurred ON work_items(occurred_at);
CREATE INDEX IF NOT EXISTS idx_items_source ON work_items(source_type);
CREATE INDEX IF NOT EXISTS idx_items_chat ON work_items(chat_id);
CREATE TABLE IF NOT EXISTS chats (
  conversation_id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT,
  latest_message_time TEXT,
  last_collected_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  aliases TEXT,
  origin TEXT NOT NULL DEFAULT 'user',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS entity_links (
  entity_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  reason TEXT,
  PRIMARY KEY(entity_id, item_id)
);
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  payload TEXT NOT NULL,
  sources TEXT NOT NULL,
  model TEXT,
  generated_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `
CREATE TABLE IF NOT EXISTS daily_summaries (
  id TEXT PRIMARY KEY,
  summary_date TEXT NOT NULL UNIQUE,
  overview TEXT,
  achievements TEXT,
  decisions TEXT,
  blockers TEXT,
  next_actions TEXT,
  metrics TEXT,
  source_references TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  generated_at TEXT,
  updated_at TEXT
);
`,
  },
  {
    version: 3,
    sql: `
ALTER TABLE work_items ADD COLUMN local_date TEXT;
CREATE INDEX IF NOT EXISTS idx_items_local_date ON work_items(local_date);
`,
  },
  {
    version: 4,
    sql: `
ALTER TABLE work_items ADD COLUMN local_hour INTEGER;
`,
  },
  {
    version: 5,
    sql: `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);
`,
  },
  {
    version: 6,
    sql: `
CREATE TABLE IF NOT EXISTS action_logs (
  id TEXT PRIMARY KEY,
  operator TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  params TEXT,
  status TEXT NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL
);
`,
  },
  {
    // AI 对话（面板内聊天）：会话与消息持久化，模型仍由 DSH llm 服务提供
    version: 7,
    sql: `
CREATE TABLE IF NOT EXISTS ai_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_chat_msgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  aborted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_chat_msgs_chat ON ai_chat_msgs (chat_id, id);
`,
  },
]

export class WorkHubDB {
  constructor(filePath) {
    const dir = process.env.DSH_PROFILE_DIR
      ? path.join(process.env.DSH_PROFILE_DIR, 'workhub')
      : path.join(os.homedir(), '.dsh', 'workhub')
    fs.mkdirSync(dir, { recursive: true })
    this.filePath = filePath ?? path.join(dir, 'data.db')
    this.db = new DatabaseSync(this.filePath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.migrate()
  }

  migrate() {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)',
    )
    const applied = new Set(
      (this.db.prepare('SELECT version FROM schema_migrations').all() || []).map((r) => r.version),
    )
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue
      this.db.exec('BEGIN')
      try {
        this.db.exec(m.sql)
        this.db
          .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(m.version, new Date().toISOString())
        this.db.exec('COMMIT')
      } catch (e) {
        this.db.exec('ROLLBACK')
        throw e
      }
    }
    this.backfillLocalDates()
  }

  /** local_date = enterprise-TZ calendar day of occurred_at (host timezone). */
  backfillLocalDates() {
    const rows =
      this.db
        .prepare("SELECT id, occurred_at FROM work_items WHERE local_date IS NULL OR local_date = '' OR local_hour IS NULL")
        .all() || []
    if (!rows.length) return
    const stmt = this.db.prepare('UPDATE work_items SET local_date = ?, local_hour = ? WHERE id = ?')
    this.db.exec('BEGIN')
    try {
      for (const r of rows) {
        const d = new Date(r.occurred_at)
        if (Number.isNaN(d.getTime())) {
          stmt.run(String(r.occurred_at).slice(0, 10), 12, r.id)
          continue
        }
        const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        stmt.run(local, d.getHours(), r.id)
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  /* ------------------------------ work_items ------------------------------ */

  /** Mark daily summaries stale when their underlying events change (v3 §7.2). */
  markSummariesStale(dates) {
    if (!dates.length) return
    const stmt = this.db.prepare("UPDATE daily_summaries SET status = 'stale', updated_at = ? WHERE summary_date = ? AND status != 'stale'")
    for (const d of dates) stmt.run(new Date().toISOString(), d)
  }

  upsertWorkItems(rows) {
    if (!rows.length) return 0
    // Positional parameters only: the Host's node:sqlite build showed
    // stricter named-parameter behavior than the system Node.
    const stmt = this.db.prepare(`
      INSERT INTO work_items (id, source_type, source_id, title, content, actor, occurred_at, chat_id, raw_json, fetched_at, local_date, local_hour)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_type, source_id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        actor = excluded.actor,
        occurred_at = excluded.occurred_at,
        chat_id = excluded.chat_id,
        raw_json = excluded.raw_json,
        fetched_at = excluded.fetched_at,
        local_date = excluded.local_date,
        local_hour = excluded.local_hour
    `)
    let n = 0
    this.db.exec('BEGIN')
    try {
      for (const r of rows) {
        const x = normalizeRow(r)
        stmt.run(
          x.id, x.source_type, x.source_id, x.title, x.content, x.actor,
          x.occurred_at, x.chat_id, x.raw_json, x.fetched_at, x.local_date, x.local_hour,
        )
        n++
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    this.markSummariesStale([...new Set(rows.map((r) => r.local_date ?? normalizeRow(r).local_date).filter(Boolean))])
    return n
  }

  listWorkItems({ sourceType, chatId, limit = 50, offset = 0, withRaw = false } = {}) {
    const where = []
    const params = []
    if (sourceType) {
      where.push('source_type = ?')
      params.push(sourceType)
    }
    if (chatId) {
      where.push('chat_id = ?')
      params.push(chatId)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    params.push(Math.min(200, Math.max(1, limit)), Math.max(0, offset))
    // withRaw：minutes 采集器需要 raw_json 判断详情是否已拉取（此前恒缺列导致每次全量重拉）
    const cols = withRaw
      ? 'id, source_type, source_id, title, content, actor, occurred_at, chat_id, fetched_at, raw_json'
      : 'id, source_type, source_id, title, content, actor, occurred_at, chat_id, fetched_at'
    return this.db
      .prepare(
        `SELECT ${cols}
         FROM work_items ${clause}
         ORDER BY occurred_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params)
  }

  countItems() {
    const rows = this.db
      .prepare('SELECT source_type, COUNT(*) AS n FROM work_items GROUP BY source_type')
      .all()
    return Object.fromEntries((rows || []).map((r) => [r.source_type, r.n]))
  }

  activityByDay(days = 14) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    return (
      this.db
        .prepare(
          `SELECT local_date AS day, source_type, COUNT(*) AS n
           FROM work_items WHERE local_date >= ?
           GROUP BY day, source_type ORDER BY day`,
        )
        .all(since) || []
    )
  }

  /* --------------------------------- chats -------------------------------- */

  upsertChats(rows) {
    if (!rows.length) return 0
    const stmt = this.db.prepare(`
      INSERT INTO chats (conversation_id, name, type, latest_message_time, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        latest_message_time = excluded.latest_message_time,
        updated_at = excluded.updated_at
    `)
    let n = 0
    this.db.exec('BEGIN')
    try {
      for (const r of rows) {
        stmt.run(
          r.conversation_id,
          r.name ?? null,
          r.type ?? null,
          r.latest_message_time ?? null,
          new Date().toISOString(),
        )
        n++
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return n
  }

  /** conversationId → collected chat_message count. */
  chatMessageCounts() {
    const rows = this.db
      .prepare("SELECT chat_id, COUNT(*) AS n FROM work_items WHERE source_type = 'chat_message' AND chat_id IS NOT NULL GROUP BY chat_id")
      .all() || []
    return Object.fromEntries(rows.map((r) => [r.chat_id, r.n]))
  }

  listChats(limit = 100) {
    return (
      this.db
        .prepare(
          `SELECT * FROM chats
           ORDER BY COALESCE(latest_message_time, '') DESC LIMIT ?`,
        )
        .all(Math.min(500, Math.max(1, limit))) || []
    )
  }

  markChatCollected(conversationId) {
    this.db
      .prepare('UPDATE chats SET last_collected_at = ? WHERE conversation_id = ?')
      .run(new Date().toISOString(), conversationId)
  }

  /* ------------------------------ sync_state ------------------------------ */

  getSyncState(source) {
    return this.db.prepare('SELECT * FROM sync_state WHERE source = ?').get(source)
  }

  listSyncState() {
    return this.db.prepare('SELECT * FROM sync_state ORDER BY source').all() || []
  }

  setSyncState(source, { status, cursor, totalSynced, error } = {}) {
    const now = new Date().toISOString()
    const prev = this.getSyncState(source)
    const total = totalSynced ?? (prev ? prev.total_synced || 0 : 0)
    const st = status ?? 'idle'
    const err = error ?? null
    const cur = cursor ?? null
    this.db
      .prepare(
        `INSERT INTO sync_state (source, cursor, last_sync_at, status, total_synced, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source) DO UPDATE SET
           cursor = COALESCE(?, cursor),
           last_sync_at = ?,
           status = ?,
           total_synced = COALESCE(?, total_synced),
           last_error = ?,
           updated_at = ?`,
      )
      .run(
        source, cur, now, st, total, err, now,
        cur, now, st, total, err, now,
      )
  }

  /* ------------------------------ projects ------------------------------- */

  createProject({ name, aliases = [], keywords = [], chatIds = [] }) {
    const id = `project:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    this.db
      .prepare('INSERT INTO entities (id, type, name, aliases, origin, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, 'project', name, JSON.stringify({ aliases, keywords, chatIds }), 'user', new Date().toISOString())
    return this.getProject(id)
  }

  updateProject(id, { name, aliases, keywords, chatIds }) {
    const prev = this.getProject(id)
    if (!prev) throw new Error('project not found')
    const merged = {
      ...prev.rules,
      ...(aliases !== undefined ? { aliases } : {}),
      ...(keywords !== undefined ? { keywords } : {}),
      ...(chatIds !== undefined ? { chatIds } : {}),
    }
    this.db
      .prepare('UPDATE entities SET name = ?, aliases = ? WHERE id = ?')
      .run(name ?? prev.name, JSON.stringify(merged), id)
    return this.getProject(id)
  }

  deleteProject(id) {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM entity_links WHERE entity_id = ?').run(id)
      this.db.prepare('DELETE FROM entities WHERE id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  getProject(id) {
    const row = this.db.prepare("SELECT * FROM entities WHERE id = ? AND type = 'project'").get(id)
    return row ? decodeProject(row) : null
  }

  listProjects() {
    const rows = this.db.prepare("SELECT * FROM entities WHERE type = 'project' ORDER BY name").all() || []
    return rows.map(decodeProject)
  }

  /**
   * Rule-based ProjectResolver (v2 §5.1 layer 2): chat binding + keyword/alias
   * matching. Rebuilds rule links (confidence 1.0); future AI links
   * (confidence < 1) are preserved.
   */
  resolveProjectLinks({ incremental = false } = {}) {
    // incremental=true（定时同步路径）：以 rowid 游标只扫描上次归集后新增的行，
    // 不重建既有链接；游标缺失或超过 24h 自动退回全量（兜住「内容改后命中关键词」的漂移）。
    // 项目增删改与手动归集仍走全量（incremental 缺省）。
    const cursorAt = Number(this.getSetting('projects.linkCursorAt') ?? 0)
    const useIncremental = incremental && cursorAt > 0 && Date.now() - cursorAt < 24 * 3600_000
    const projects = this.listProjects()
    let linkRows = 0
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO entity_links (entity_id, item_id, confidence, reason) VALUES (?, ?, 1.0, ?)',
    )
    this.db.exec('BEGIN')
    try {
      let cursor = 0
      if (useIncremental) {
        cursor = Number(this.getSetting('projects.linkCursor') ?? 0)
      } else {
        // rebuild only rule-layer links; keep direct fact links (yunxiao-space etc.)
        this.db.prepare("DELETE FROM entity_links WHERE reason = 'chat-binding' OR reason LIKE 'keyword:%'").run()
      }
      const bindChat = this.db.prepare(
        `SELECT id FROM work_items WHERE chat_id = ? ${cursor ? 'AND rowid > ?' : ''}`,
      )
      const matchTerm = this.db.prepare(
        `SELECT id FROM work_items WHERE source_type != 'chat_message' AND (title LIKE ? OR content LIKE ? OR actor LIKE ?) ${cursor ? 'AND rowid > ?' : ''}`,
      )
      for (const p of projects) {
        const { keywords, chatIds, aliases } = p.rules
        for (const cid of chatIds ?? []) {
          const rows = cursor ? bindChat.all(cid, cursor) : bindChat.all(cid)
          for (const r of rows || []) {
            insert.run(p.id, r.id, `chat-binding`)
            linkRows++
          }
        }
        const terms = [...new Set([...(keywords ?? []), ...(aliases ?? []), p.name])].filter(Boolean)
        for (const term of terms) {
          const like = `%${term.replace(/[%_]/g, ' ')}%`
          const rows = cursor ? matchTerm.all(like, like, like, cursor) : matchTerm.all(like, like, like)
          for (const r of rows || []) {
            insert.run(p.id, r.id, `keyword:${term}`)
            linkRows++
          }
        }
      }
      const maxRowid = (this.db.prepare('SELECT MAX(rowid) AS m FROM work_items').get() || {}).m ?? 0
      this.setSetting('projects.linkCursor', String(maxRowid))
      this.setSetting('projects.linkCursorAt', String(Date.now()))
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM work_items').get() || {}).n ?? 0
    const linkedItems = new Set(
      (this.db.prepare('SELECT DISTINCT item_id FROM entity_links').all() || []).map((r) => r.item_id),
    ).size
    return { projects: projects.length, linkRows, totalItems: total, linkedItems, unlinkedItems: total - linkedItems, incremental: useIncremental }
  }

  /** Upsert a Yunxiao-synced project entity (origin 'yunxiao'). */
  upsertYunxiaoProject({ externalId, name, keywords = [], raw }) {
    const id = `yunxiao:project:${externalId}`
    const existing = this.db.prepare('SELECT aliases FROM entities WHERE id = ?').get(id)
    let rules = { keywords, externalId }
    if (existing) {
      try { rules = { ...JSON.parse(existing.aliases || '{}'), keywords } } catch {}
    }
    this.db
      .prepare(
        `INSERT INTO entities (id, type, name, aliases, origin, created_at) VALUES (?, 'project', ?, ?, 'yunxiao', ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, aliases = excluded.aliases`,
      )
      .run(id, name, JSON.stringify(rules), new Date().toISOString())
    return id
  }

  /** Direct fact-based project link (e.g. yunxiao workitem → its space project). */
  linkItemToProject(entityId, itemId, reason) {
    this.db
      .prepare('INSERT OR IGNORE INTO entity_links (entity_id, item_id, confidence, reason) VALUES (?, ?, 1.0, ?)')
      .run(entityId, itemId, reason)
  }

  /** Deterministic project fact stats over a date range (v3 §7.3). */
  projectFactStats(projectId, startDate, endDate) {
    const rows =
      this.db
        .prepare(
          `SELECT w.source_type, w.content, w.raw_json FROM entity_links l
           JOIN work_items w ON w.id = l.item_id
           WHERE l.entity_id = ? AND w.local_date >= ? AND w.local_date <= ?`,
        )
        .all(projectId, startDate, endDate) || []
    const stats = {
      commits: 0, requirements: {}, tasks: 0, worklogHours: 0, worklogEntries: 0,
      attendance: 0, chatMessages: 0, reports: 0, meetings: 0, todos: 0,
    }
    for (const r of rows) {
      switch (r.source_type) {
        case 'commit': stats.commits++; break
        case 'task': stats.tasks++; break
        case 'chat_message': stats.chatMessages++; break
        case 'report': stats.reports++; break
        case 'minutes': stats.meetings++; break
        case 'todo': stats.todos++; break
        case 'attendance': stats.attendance++; break
        case 'requirement': {
          const status = r.content || '未知'
          stats.requirements[status] = (stats.requirements[status] ?? 0) + 1
          break
        }
        case 'worklog': {
          try {
            const raw = JSON.parse(r.raw_json || '{}')
            stats.worklogHours += Number(raw.actualTime) || 0
            stats.worklogEntries++
          } catch {}
          break
        }
      }
    }
    stats.worklogHours = Math.round(stats.worklogHours * 10) / 10
    return stats
  }

  /* ----------------------------- action logs ------------------------------ */

  logAction({ operator, action, target, params, status, result }) {
    const id = `act:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    this.db
      .prepare('INSERT INTO action_logs (id, operator, action, target, params, status, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, operator, action, target ?? null, params ? JSON.stringify(params) : null, status ?? 'ok', result ? JSON.stringify(result) : null, new Date().toISOString())
    return id
  }

  listActions(limit = 50) {
    return this.db.prepare('SELECT * FROM action_logs ORDER BY created_at DESC LIMIT ?').all(Math.min(200, limit)) || []
  }

  /* ------------------------------ analytics ------------------------------ */

  projectActivity(days = 7) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    return (
      this.db
        .prepare(
          `SELECT e.id, e.name, w.source_type, COUNT(*) AS n
           FROM entity_links l
           JOIN entities e ON e.id = l.entity_id
           JOIN work_items w ON w.id = l.item_id
           WHERE substr(w.occurred_at, 1, 10) >= ?
           GROUP BY e.id, e.name, w.source_type
           ORDER BY e.name`,
        )
        .all(since) || []
    )
  }

  projectActivityRange(startDate, endDate) {
    return (
      this.db
        .prepare(
          `SELECT e.id, e.name, w.source_type, COUNT(*) AS n
           FROM entity_links l
           JOIN entities e ON e.id = l.entity_id
           JOIN work_items w ON w.id = l.item_id
           WHERE w.local_date >= ? AND w.local_date <= ?
           GROUP BY e.id, e.name, w.source_type
           ORDER BY e.name`,
        )
        .all(startDate, endDate) || []
    )
  }

  /** Group activity rows (day, source_type, n) within a range for bucketing. */
  activityRange(startDate, endDate, actors) {
    const mine = this.mineActivityClause(actors)
    const where = mine
      ? `WHERE local_date >= ? AND local_date <= ? AND ${mine.sql}`
      : 'WHERE local_date >= ? AND local_date <= ?'
    const params = mine ? [startDate, endDate, ...mine.params] : [startDate, endDate]
    return (
      this.db
        .prepare(
          `SELECT local_date AS day, source_type, COUNT(*) AS n
           FROM work_items
           ${where}
           GROUP BY day, source_type ORDER BY day`,
        )
        .all(...params) || []
    )
  }

  periodCounts(daysAgoFrom, daysAgoTo) {
    // day window: items with day <= today-daysAgoFrom AND day > today-daysAgoTo
    const rows =
      this.db
        .prepare(
          `SELECT source_type, COUNT(*) AS n FROM work_items
           WHERE local_date <= ? AND local_date > ?
           GROUP BY source_type`,
        )
        .all(dayIso(daysAgoFrom), dayIso(daysAgoTo)) || []
    return Object.fromEntries(rows.map((r) => [r.source_type, r.n]))
  }

  /* ------------------------------ analyses ------------------------------- */

  saveAnalysis({ kind, scope, payload, sources, model }) {
    const id = `an:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    this.db
      .prepare('INSERT INTO analyses (id, kind, scope, payload, sources, model, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        id, kind,
        JSON.stringify(scope ?? {}),
        JSON.stringify(payload ?? {}),
        JSON.stringify(sources ?? []),
        model ?? null,
        new Date().toISOString(),
      )
    return this.getAnalysis(id)
  }

  getAnalysis(id) {
    const row = this.db.prepare('SELECT * FROM analyses WHERE id = ?').get(id)
    return row ? decodeAnalysis(row) : null
  }

  listAnalyses({ kind, projectId, limit = 50 } = {}) {
    // 过滤条件下推 SQL：此前先 LIMIT 再 JS 过滤，最新 N 条若全是其他 kind 会漏结果
    // （曾导致 Watchdog 24h 去重失效，重复生成同标题洞见）
    const where = []
    const params = []
    if (kind) { where.push('kind = ?'); params.push(kind) }
    if (projectId) { where.push("json_extract(scope, '$.projectId') = ?"); params.push(projectId) }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    params.push(Math.min(200, Math.max(1, limit)))
    const rows = this.db
      .prepare(`SELECT * FROM analyses ${clause} ORDER BY generated_at DESC LIMIT ?`)
      .all(...params) || []
    return rows.map(decodeAnalysis)
  }

  deleteAnalysis(id) {
    this.db.prepare('DELETE FROM analyses WHERE id = ?').run(id)
  }

  /* ------------------------------- ai_chats ------------------------------- */

  listAiChats(limit = 50) {
    return (
      this.db
        .prepare(
          `SELECT c.id, c.title, c.created_at, c.updated_at,
                  (SELECT COUNT(*) FROM ai_chat_msgs m WHERE m.chat_id = c.id) AS msgs
           FROM ai_chats c ORDER BY c.updated_at DESC LIMIT ?`,
        )
        .all(Math.min(200, Math.max(1, limit))) || []
    )
  }

  getAiChat(id) {
    const chat = this.db.prepare('SELECT * FROM ai_chats WHERE id = ?').get(id)
    if (!chat) return null
    const messages =
      this.db
        .prepare('SELECT id, role, content, model, aborted, created_at FROM ai_chat_msgs WHERE chat_id = ? ORDER BY id ASC LIMIT 400')
        .all(id) || []
    return { chat, messages }
  }

  createAiChat() {
    const now = new Date().toISOString()
    const r = this.db.prepare('INSERT INTO ai_chats (title, created_at, updated_at) VALUES (?, ?, ?)').run('', now, now)
    return Number(r.lastInsertRowid)
  }

  /** 追加一条消息并触碰会话；首条用户消息自动成为标题。 */
  saveAiChatMessage({ chatId, role, content, model = null, aborted = false }) {
    const now = new Date().toISOString()
    const r = this.db
      .prepare('INSERT INTO ai_chat_msgs (chat_id, role, content, model, aborted, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(chatId, role, String(content ?? ''), model, aborted ? 1 : 0, now)
    const title = role === 'user' ? String(content ?? '').replace(/\s+/g, ' ').trim().slice(0, 24) : null
    this.db
      .prepare("UPDATE ai_chats SET updated_at = ?, title = CASE WHEN title = '' AND ? IS NOT NULL THEN ? ELSE title END WHERE id = ?")
      .run(now, title, title, chatId)
    return Number(r.lastInsertRowid)
  }

  deleteAiChat(id) {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM ai_chat_msgs WHERE chat_id = ?').run(id)
      this.db.prepare('DELETE FROM ai_chats WHERE id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  /** Assemble an LLM analysis input for one project: linked items + sources. */
  projectAnalysisInput(projectId, days = 14) {
    const project = this.getProject(projectId)
    if (!project) throw new Error('project not found')
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    const rows =
      this.db
        .prepare(
          `SELECT w.* FROM entity_links l JOIN work_items w ON w.id = l.item_id
           WHERE l.entity_id = ? AND substr(w.occurred_at, 1, 10) >= ?
           ORDER BY w.occurred_at DESC LIMIT 200`,
        )
        .all(projectId, since) || []
    const grouped = {}
    const sources = []
    for (const w of rows) {
      grouped[w.source_type] = grouped[w.source_type] || []
      grouped[w.source_type].push({
        id: w.id,
        title: w.title,
        actor: w.actor,
        occurredAt: w.occurred_at,
        contentPreview: w.content ? w.content.slice(0, 300) : undefined,
      })
      sources.push({
        sourceType: w.source_type,
        sourceId: w.source_id,
        itemId: w.id,
        title: w.title,
        timestamp: w.occurred_at,
      })
    }
    return { project, days, grouped, sources, stats: { total: rows.length } }
  }

  /** Look up minimal source refs for item ids (used when saving insights). */
  sourcesForItems(itemIds) {
    const out = []
    for (const itemId of (itemIds ?? []).slice(0, 100)) {
      const w = this.db.prepare('SELECT * FROM work_items WHERE id = ?').get(String(itemId))
      if (w) {
        out.push({
          sourceType: w.source_type, sourceId: w.source_id, itemId: w.id,
          title: w.title, timestamp: w.occurred_at,
        })
      }
    }
    return out
  }

  /** Deterministic chat analysis input: per-day/per-sender stats + messages. */
  chatAnalysisInput(chatId, days = 14) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    const rows =
      this.db
        .prepare(
          `SELECT * FROM work_items
           WHERE chat_id = ? AND source_type = 'chat_message' AND local_date >= ?
           ORDER BY occurred_at DESC LIMIT 500`,
        )
        .all(chatId, since) || []
    const byDay = {}
    const bySender = {}
    const messages = []
    const sources = []
    for (const m of rows) {
      const day = m.occurred_at.slice(0, 10)
      byDay[day] = (byDay[day] ?? 0) + 1
      const sender = m.actor || 'unknown'
      bySender[sender] = (bySender[sender] ?? 0) + 1
      messages.push({
        itemId: m.id, day, sender,
        text: (m.content || m.title || '').slice(0, 200),
        occurredAt: m.occurred_at,
      })
      sources.push({
        sourceType: 'chat_message', sourceId: m.source_id, itemId: m.id,
        title: m.title, timestamp: m.occurred_at,
      })
    }
    const chat = this.db.prepare('SELECT * FROM chats WHERE conversation_id = ?').get(chatId)
    return {
      chat: chat ? { conversationId: chat.conversation_id, name: chat.name, type: chat.type } : { conversationId: chatId },
      days,
      stats: {
        total: rows.length,
        byDay,
        bySender,
        participants: Object.keys(bySender).length,
      },
      messages: messages.slice(0, 200),
      sources,
    }
  }

  /** Deterministic report input: project-linked or global, plus period metrics. */
  /**
   * 周报草稿（按人维度）：近 7 天概览 + 每人分区（提交/进行中/消息 + 明细）。
   * 返回 saveAnalysis 所需结构；evidence 用近期工作项兜底。
   */
  buildWeeklyDraft({ agendaSection } = {}) {
    const input = this.reportInput({ days: 7 })
    const counts = input.thisPeriod ?? {}
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    const start = dayIso(7)
    const end = dayIso(1)
    const sections = [{ title: '整体概览', content: `近 7 天（${start} ~ ${end}）共 ${total} 条工作事件：${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}` }]
    for (const m of input.byPerson?.members ?? []) {
      const lines = []
      if (m.commits.recent.length) lines.push(`最近提交：${m.commits.recent.join('；')}`)
      if (m.inProgress.items.length) lines.push(`进行中：${m.inProgress.items.map((it) => `${it.title}（${it.status}）`).join('；')}`)
      if (m.chats.n >= 50) lines.push(`消息活跃（${m.chats.n} 条）`)
      sections.push({
        title: `${m.name} · 提交 ${m.commits.n} / 进行中 ${m.inProgress.n} / 消息 ${m.chats.n}`,
        content: lines.join('\n') || '本周无记录',
      })
    }
    // 待办统计（同步库内 source_type='todo'，按周区间）
    const todoRows = this.db
      .prepare("SELECT title, local_date AS day FROM work_items WHERE source_type = 'todo' AND local_date >= ? AND local_date <= ? ORDER BY day")
      .all(start, end) || []
    if (todoRows.length) {
      const byDay = {}
      for (const r of todoRows) byDay[r.day] = (byDay[r.day] ?? 0) + 1
      sections.push({
        title: `待办 · 本周新增 ${todoRows.length} 条`,
        content: `按日新增：${Object.entries(byDay).map(([d, n]) => `${d.slice(5)} ${n} 条`).join('；')}`,
      })
    }
    if (agendaSection) sections.push(agendaSection)
    const evidence = (input.recent ?? []).slice(0, 5).map((r) => r.itemId).filter(Boolean)
    return {
      title: `周报草稿（按人） · ${start} ~ ${end}`,
      overview: `近 7 天团队工作概览，共 ${total} 条事件，覆盖 ${sections.length - 1} 名成员。由 WorkHub 自动汇总，供修改后提交。`,
      sections,
      evidenceItemIds: evidence,
    }
  }

  /** 周五 17 点后自动生成本周草稿（每周一份；report.weeklyAuto 开关）。force=1 手动触发。 */
  saveWeeklyDraftIfDue({ force = false, agendaSection } = {}) {
    if (force !== true && this.getSetting('report.weeklyAuto') !== '1') return null
    const now = new Date()
    if (force !== true && (now.getDay() !== 5 || now.getHours() < 17)) return null
    const weekKey = dayIso(0) // 周五当天日期
    if (!force && this.getSetting('report.weeklyLast') === weekKey) return null
    const draft = this.buildWeeklyDraft({ agendaSection })
    const evidence = this.sourcesForItems(draft.evidenceItemIds)
    if (!evidence.length) return null
    const analysis = this.saveAnalysis({
      kind: 'report_draft',
      scope: { periodDays: 7, auto: true },
      payload: { title: draft.title, overview: draft.overview, sections: draft.sections },
      sources: evidence,
      model: 'workhub-auto',
    })
    this.setSetting('report.weeklyLast', weekKey)
    return analysis
  }

  /**
   * 按人维度聚合（日报/周报的个人分区数据源）：
   * 取所有部门成员（无部门则高频活跃人）在周期内的提交/进行中需求/消息，按总活跃倒序。
   */
  byPersonInput({ days = 7, start, end, perMember = 3 } = {}) {
    let members = []
    try {
      const raw = JSON.parse(this.getSetting('workhub.groups') ?? '[]')
      if (Array.isArray(raw)) members = raw.flatMap((g) => (Array.isArray(g?.members) ? g.members : []))
    } catch { /* ignore */ }
    if (!members.length) members = [...this.topActorsByType('commit', 8), ...this.topActorsByType('chat_message', 6)].slice(0, 10)
    const acts = this.groupMemberActivity({ start: start ?? dayIso(days), end: end ?? dayIso(0), members, perMember })
      .filter((m) => m.commits.n + m.inProgress.n + m.chats.n > 0)
      .sort((a, b) => (b.commits.n + b.inProgress.n + b.chats.n) - (a.commits.n + a.inProgress.n + a.chats.n))
    return { windowDays: days, members: acts }
  }

  reportInput({ projectId, days = 7 } = {}) {
    const base = {
      days,
      thisPeriod: this.periodCounts(days, days * 2),
      prevPeriod: this.periodCounts(days * 2, days * 3),
      byPerson: this.byPersonInput({ days }),
    }
    if (projectId) {
      const project = this.projectAnalysisInput(projectId, days)
      return { ...base, project: project.project, grouped: project.grouped, sources: project.sources }
    }
    const rows = this.listWorkItems({ limit: 100 })
    return {
      ...base,
      recent: rows.map((r) => ({ itemId: r.id, sourceType: r.source_type, title: r.title, occurredAt: r.occurred_at })),
      sources: rows.map((r) => ({
        sourceType: r.source_type, sourceId: r.source_id, itemId: r.id, title: r.title, timestamp: r.occurred_at,
      })),
    }
  }

  /* ------------------------------ calendar ------------------------------- */
  // Work events are derived from work_items (+ project links) rather than a
  // duplicate work_events table; daily_summaries stores the AI layer only.

  /** Per-day event counts for one month (YYYY-MM), optionally one project. */
  calendarMonth(month, projectId) {
    if (!/^\d{4}-\d{2}$/.test(String(month))) {
      const err = new Error('invalid month (YYYY-MM)'); err.status = 400; throw err
    }
    const linkJoin = projectId ? 'JOIN entity_links l ON l.item_id = w.id AND l.entity_id = ?' : ''
    const scopeParams = projectId ? [projectId, month] : [month]

    const rows =
      this.db
        .prepare(
          `SELECT w.local_date AS day, w.source_type, COUNT(*) AS n
           FROM work_items w
           ${linkJoin}
           WHERE substr(w.local_date, 1, 7) = ?
           GROUP BY day, w.source_type`,
        )
        .all(...scopeParams) || []

    // 考勤/报工是个人时间记录，不随项目过滤（带项目筛选时也始终展示打卡）
    const detailRows =
      this.db
        .prepare(
          `SELECT w.local_date AS day, w.source_type, w.occurred_at, w.raw_json
           FROM work_items w
           WHERE substr(w.local_date, 1, 7) = ? AND w.source_type IN ('attendance','worklog')`,
        )
        .all(month) || []

    const projRows =
      this.db
        .prepare(
          `SELECT w.local_date AS day, e.id AS projectId, e.name AS projectName, COUNT(*) AS n
           FROM entity_links l
           JOIN entities e ON e.id = l.entity_id
           JOIN work_items w ON w.id = l.item_id
           WHERE substr(w.local_date, 1, 7) = ?
           GROUP BY day, e.id`,
        )
        .all(month) || []

    const summaries = new Set(
      (this.db
        .prepare('SELECT summary_date FROM daily_summaries WHERE substr(summary_date, 1, 7) = ?')
        .all(month) || []).map((r) => r.summary_date),
    )

    const hhmm = (iso) => {
      const d = new Date(iso)
      return Number.isNaN(d.getTime())
        ? null
        : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }

    const days = {}
    const ensure = (date) => (days[date] = days[date] || {
      date, events: 0, meetings: 0, todos: 0, chats: 0, reports: 0,
      commits: 0, requirements: 0, tasks: 0,
      attendance: 0, checkIn: null, checkOut: null,
      worklogHours: 0, worklogEntries: 0,
      projects: {},
    })

    for (const r of rows) {
      const d = ensure(r.day)
      d.events += r.n
      if (r.source_type === 'minutes' || r.source_type === 'calendar_event') d.meetings += r.n
      if (r.source_type === 'todo') d.todos += r.n
      if (r.source_type === 'chat_message') d.chats += r.n
      if (r.source_type === 'report') d.reports += r.n
      if (r.source_type === 'commit') d.commits += r.n
      if (r.source_type === 'requirement') d.requirements += r.n
      if (r.source_type === 'task') d.tasks += r.n
    }

    for (const r of detailRows) {
      const d = ensure(r.day)
      if (r.source_type === 'attendance') {
        d.attendance += 1 // 计数与打卡时间都来自未过滤明细，项目筛选下也准确
        const t = hhmm(r.occurred_at)
        if (t) {
          if (!d.checkIn || t < d.checkIn) d.checkIn = t
          if (!d.checkOut || t > d.checkOut) d.checkOut = t
        }
      } else if (r.source_type === 'worklog') {
        try {
          const raw = JSON.parse(r.raw_json || '{}')
          d.worklogHours += Number(raw.actualTime) || 0
        } catch {}
        d.worklogEntries += 1
      }
    }

    for (const r of projRows) {
      const d = days[r.day]
      if (d) d.projects[r.projectName] = (d.projects[r.projectName] ?? 0) + r.n
    }

    // 当日提交次数最多的需求号（用于日历卡片）
    const commitRows =
      this.db
        .prepare(
          `SELECT w.local_date AS day, w.title
           FROM work_items w
           ${linkJoin}
           WHERE substr(w.local_date, 1, 7) = ? AND w.source_type = 'commit'`,
        )
        .all(...scopeParams) || []
    const commitReqCount = new Map() // day → Map(serial → { n, title })
    for (const r of commitRows) {
      const m = REQ_RE.exec(String(r.title ?? ''))
      if (!m) continue
      const perDay = commitReqCount.get(r.day) ?? new Map()
      const prev = perDay.get(m[1])
      if (prev) prev.n += 1
      else perDay.set(m[1], { n: 1, title: String(r.title ?? '').slice(0, 80) })
      commitReqCount.set(r.day, perDay)
    }

    // 云效需求排期节点：日历重点展示
    const milestoneRows =
      this.db
        .prepare(
          `SELECT w.local_date AS day, w.source_id, w.title, w.content
           FROM work_items w
           ${projectId ? 'JOIN entity_links l ON l.item_id = w.id AND l.entity_id = ?' : ''}
           WHERE substr(w.local_date, 1, 7) = ? AND w.source_type = 'milestone'
           ORDER BY w.local_date, w.source_id`,
        )
        .all(...scopeParams) || []
    // 同一天同一需求的多个节点合并，按重要性取代表节点
    const MILESTONE_RANK = { '期望上线': 0, '计划完成': 1, '计划提测': 2, '计划开始': 3, '评审通过': 4, '技术排期': 5 }
    const statusMap = this.requirementStatusMap()
    const weekStart = this.weekStartIso()
    for (const r of milestoneRows) {
      const serialOfRow = String(r.title ?? '').split(' ')[0] || r.source_id
      if (this.isRetiredRequirement(serialOfRow, r.day, statusMap, weekStart)) continue
      const d = ensure(r.day)
      d._ms = d._ms || {}
      const title = String(r.title ?? '')
      const serial = title.split(' ')[0] || r.source_id
      const label = title.slice(serial.length).trim()
      const rank = MILESTONE_RANK[label] ?? 9
      const prev = d._ms[serial]
      if (!prev) {
        d._ms[serial] = { serial, label, rank, detail: r.content, count: 1 }
      } else {
        prev.count += 1
        if (rank < prev.rank) {
          prev.label = label
          prev.rank = rank
          prev.detail = r.content
        }
      }
    }
    for (const d of Object.values(days)) {
      if (!d._ms) continue
      const list = Object.values(d._ms).sort((a, b) => a.rank - b.rank || a.serial.localeCompare(b.serial))
      d.milestoneCount = list.length
      d.milestones = list.slice(0, 3).map((m) => ({ id: m.serial, title: `${m.serial} ${m.label}`, detail: m.detail, count: m.count }))
      delete d._ms
    }

    for (const [day, perDay] of commitReqCount) {
      const target = days[day] ?? ensure(day)
      const list = [...perDay.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
      if (list[0]) target.topRequirement = { serial: list[0][0], count: list[0][1].n }
      // 悬浮提示用：当日需求提交明细（最多 3 条）
      target.topReqs = list.slice(0, 3).map(([serial, v]) => ({ serial, count: v.n, title: v.title }))
    }

    for (const d of Object.values(days)) {
      d.hasSummary = summaries.has(d.date)
      d.worklogHours = Math.round(d.worklogHours * 10) / 10
      if (d.checkIn && d.checkOut && d.checkIn === d.checkOut) d.checkOut = null
      d.attendanceComplete = d.attendance >= 2
    }
    return Object.values(days).sort((a, b) => a.date.localeCompare(b.date))
  }

  /** Monday of the current local week (YYYY-MM-DD). */
  weekStartIso() {
    const d = new Date()
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
  }

  /** serialNumber → current requirement status text (as stored in content). */
  requirementStatusMap() {
    const rows = this.db
      .prepare("SELECT source_id, content FROM work_items WHERE source_type = 'requirement'")
      .all() || []
    return new Map(rows.map((r) => [r.source_id, r.content ?? '']))
  }

  /** A requirement already delivered before this week no longer needs attention. */
  isRetiredRequirement(serial, date, statusMap, weekStart) {
    const status = statusMap.get(serial) ?? ''
    if (!/(完成|上线|已发布|关闭|取消)/.test(status)) return false
    return String(date) < weekStart
  }

  /** 进行中需求：非终态（注意「待完成」是进行中，必须精确匹配排除终态）。 */
  /**
   * 「与我相关」过滤子句：我是需求的最近更新人 / 创建人 / 负责人 / 验证人 / 参与人，
   * 或我提交过标题引用该需求号的代码记录。actors 为空返回 null（不过滤）。
   */
  mineClause(actors) {
    const list = (Array.isArray(actors) ? actors : []).map((a) => String(a).trim()).filter(Boolean)
    if (!list.length) return null
    const ph = list.map(() => '?').join(',')
    const valid = `CASE WHEN w.raw_json IS NOT NULL AND json_valid(w.raw_json) THEN w.raw_json END`
    const sql = `(
        w.actor IN (${ph})
        OR json_extract(${valid}, '$.creator.name') IN (${ph})
        OR json_extract(${valid}, '$.assignedTo.name') IN (${ph})
        OR json_extract(${valid}, '$.verifier.name') IN (${ph})
        OR EXISTS (SELECT 1 FROM json_each(${valid}, '$.participants') je WHERE json_extract(je.value, '$.name') IN (${ph}))
        OR EXISTS (SELECT 1 FROM work_items c WHERE c.source_type = 'commit' AND c.actor IN (${ph}) AND w.source_id IS NOT NULL AND instr(c.title, w.source_id) > 0))`
    return { sql, params: [...list, ...list, ...list, ...list, ...list, ...list] }
  }

  /** 「我的活动」过滤：actor 命中身份名单，或无 actor 但类型天然属于本人（待办/打卡/报工）。
   *  采集数据含多人内容（仓库 commit、需求变更、群聊消息），统计「我的工作」时必须过滤，
   *  否则别人的提交/需求/日志会被算进来。actors 为空返回 null（不过滤，团队视角）。 */
  mineActivityClause(actors) {
    const list = (Array.isArray(actors) ? actors : []).map((a) => String(a).trim()).filter(Boolean)
    if (!list.length) return null
    const ph = list.map(() => '?').join(',')
    return {
      sql: `(actor IN (${ph}) OR (actor IS NULL AND source_type IN ('todo','attendance','worklog')))`,
      params: list,
    }
  }

  /** 我相关的需求号集合（mineClause 语义：负责人/创建人/验证人/参与人/我提交过引用它的 commit）。
   *  排期节点（milestone）本身无 actor，用该集合判断节点所属需求是否与我相关。 */
  mineRequirementSerials(actors) {
    const mine = this.mineClause(actors)
    if (!mine) return null
    const rows =
      this.db
        .prepare(`SELECT DISTINCT w.source_id FROM work_items w WHERE w.source_type = 'requirement' AND ${mine.sql}`)
        .all(...mine.params) || []
    return new Set(rows.map((r) => String(r.source_id)))
  }

  /** 提交署名 Top N（身份配置候选）。 */
  topCommitActors(limit = 8) {
    return (
      this.db
        .prepare(
          `SELECT actor FROM work_items
           WHERE source_type = 'commit' AND actor IS NOT NULL AND actor != ''
           GROUP BY actor ORDER BY COUNT(*) DESC LIMIT ?`,
        )
        .all(Math.min(20, Math.max(1, limit))) || []
    ).map((r) => r.actor)
  }

  /** 各来源高频人名候选（建部门用）。 */
  topActorsByType(sourceType, limit = 8) {
    return (
      this.db
        .prepare(
          `SELECT actor FROM work_items
           WHERE source_type = ? AND actor IS NOT NULL AND actor != ''
           GROUP BY actor ORDER BY COUNT(*) DESC LIMIT ?`,
        )
        .all(sourceType, Math.min(20, Math.max(1, limit))) || []
    ).map((r) => r.actor)
  }

  /**
   * 部门成员投入（区间聚合，精确按名单匹配，名字需同时包含钉钉名与提交署名两种形式才能算全）：
   * commits（条数+最近标题）、inProgress（非终态需求）、chats（条数+采样）。
   */
  groupMemberActivity({ start, end, members, perMember = 3 } = {}) {
    // 成员支持 '名字'、'名字:别名1|别名2' 或 {name, aliases}；同一人的钉钉名与提交署名通过别名聚合到一行
    const entries = (Array.isArray(members) ? members : [])
      .map((m) => {
        if (typeof m === 'string') {
          const [head, tail] = m.trim().split(/[:：]/)
          m = { name: head, aliases: String(tail ?? '').split(/[|｜,，、\s]+/) }
        }
        return {
          name: String(m?.name ?? '').trim(),
          aliases: (Array.isArray(m?.aliases) ? m.aliases : []).map((a) => String(a).trim()).filter(Boolean),
        }
      })
      .filter((e) => e.name)
    if (!entries.length) return []
    const allNames = []
    const owner = new Map()
    for (const e of entries) for (const n of [e.name, ...e.aliases]) if (!owner.has(n)) { owner.set(n, e.name); allNames.push(n) }
    const ph = allNames.map(() => '?').join(',')
    const TERMINAL = ['已完成', '已取消', '上线发布完成', '需求暂停', '已关闭']
    const rows =
      this.db
        .prepare(
          `SELECT actor, source_type, title, content, local_date AS day FROM work_items
           WHERE local_date >= ? AND local_date <= ? AND source_type IN ('commit','requirement','chat_message')
             AND actor IN (${ph})`,
        )
        .all(start, end, ...allNames) || []
    const by = new Map(entries.map((e) => [e.name, { name: e.name, aliases: e.aliases, commits: { n: 0, recent: [] }, inProgress: { n: 0, items: [] }, chats: { n: 0, samples: [] } }]))
    const seenReqs = new Set()
    for (const r of rows) {
      const m = by.get(owner.get(r.actor))
      if (!m) continue
      const title = String(r.title ?? '')
      if (r.source_type === 'commit') {
        m.commits.n += 1
        if (title && m.commits.recent.length < perMember) m.commits.recent.push(title.slice(0, 60))
      } else if (r.source_type === 'requirement') {
        if (r.content && TERMINAL.includes(r.content)) continue
        m.inProgress.n += 1
        if (title && !seenReqs.has(`${m.name}:${title}`)) {
          seenReqs.add(`${m.name}:${title}`)
          if (m.inProgress.items.length < perMember) m.inProgress.items.push({ title: title.slice(0, 60), status: r.content ?? '', day: r.day })
        }
      } else if (r.source_type === 'chat_message') {
        m.chats.n += 1
        if (title && m.chats.samples.length < perMember) m.chats.samples.push(title.slice(0, 50))
      }
    }
    return [...by.values()]
  }

  inProgressRequirements({ start, end, limit = 8, projectId, mineActors } = {}) {
    const TERMINAL = ['已完成', '已取消', '上线发布完成', '需求暂停', '已关闭']
    const notIn = TERMINAL.map(() => '?').join(',')
    const mine = this.mineClause(mineActors)
    const sql = `
      SELECT w.id, w.source_id, w.title, w.content AS status, w.local_date AS day, w.occurred_at
      FROM work_items w
      ${projectId ? 'JOIN entity_links l ON l.item_id = w.id AND l.entity_id = ?' : ''}
      WHERE w.source_type = 'requirement'
        AND w.local_date BETWEEN ? AND ?
        AND (w.content IS NULL OR w.content = '' OR w.content NOT IN (${notIn}))
        ${mine ? `AND ${mine.sql}` : ''}
      ORDER BY w.local_date DESC, w.occurred_at DESC
      LIMIT ?`
    const params = [
      ...(projectId ? [projectId] : []),
      start, end, ...TERMINAL, ...(mine ? mine.params : []), limit,
    ]
    return this.db.prepare(sql).all(...params) || []
  }

  /** 按项目分组的进行中需求（项目列表页用）：一次查询，内存分组。 */
  inProgressRequirementsGrouped({ start, end, perProject = 3, mineActors } = {}) {
    const TERMINAL = ['已完成', '已取消', '上线发布完成', '需求暂停', '已关闭']
    const notIn = TERMINAL.map(() => '?').join(',')
    const mine = this.mineClause(mineActors)
    const rows = this.db.prepare(`
        SELECT w.source_id, w.title, w.content AS status, w.local_date AS day, l.entity_id AS projectId
        FROM work_items w
        JOIN entity_links l ON l.item_id = w.id
        WHERE w.source_type = 'requirement'
          AND w.local_date BETWEEN ? AND ?
          AND (w.content IS NULL OR w.content = '' OR w.content NOT IN (${notIn}))
          ${mine ? `AND ${mine.sql}` : ''}
        ORDER BY w.local_date DESC, w.occurred_at DESC
        LIMIT 300`)
      .all(start, end, ...TERMINAL, ...(mine ? mine.params : [])) || []
    const groups = new Map()
    for (const r of rows) {
      const g = groups.get(r.projectId) ?? { projectId: r.projectId, total: 0, items: [] }
      g.total += 1
      if (g.items.length < perProject) g.items.push(r)
      groups.set(r.projectId, g)
    }
    return [...groups.values()]
  }

  /** Timeline of one day's events (optionally filtered to a project). */
  dayEvents(date, projectId) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      const err = new Error('invalid date (YYYY-MM-DD)'); err.status = 400; throw err
    }
    const rows =
      this.db
        .prepare(
          `SELECT w.* FROM work_items w
           ${projectId ? 'JOIN entity_links l ON l.item_id = w.id AND l.entity_id = ?' : ''}
           WHERE w.local_date = ?
           ORDER BY w.occurred_at`,
        )
        .all(...(projectId ? [projectId, date] : [date])) || []
    const chatNames = new Map(
      (this.db.prepare('SELECT conversation_id, name FROM chats').all() || [])
        .map((c) => [c.conversation_id, c.name]),
    )
    const projectOf = {}
    for (const l of this.db.prepare(
      `SELECT l.item_id, e.name FROM entity_links l JOIN entities e ON e.id = l.entity_id`,
    ).all() || []) {
      projectOf[l.item_id] = projectOf[l.item_id] || []
      projectOf[l.item_id].push(l.name)
    }
    const localTime = (iso) => {
      const d = new Date(iso)
      return Number.isNaN(d.getTime()) ? '--:--' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    return rows.map((w) => ({
      id: w.id,
      time: localTime(w.occurred_at),
      sourceType: w.source_type,
      title: w.title,
      actor: w.actor,
      chatId: w.chat_id ?? undefined,
      chatName: w.chat_id ? (chatNames.get(w.chat_id) ?? null) : undefined,
      contentPreview: w.content ? w.content.slice(0, 200) : undefined,
      projects: projectOf[w.id] ?? [],
    }))
  }

  listDailySummariesBetween(from, to) {
    return (
      this.db
        .prepare('SELECT * FROM daily_summaries WHERE summary_date >= ? AND summary_date <= ? ORDER BY summary_date DESC')
        .all(String(from), String(to)) || []
    ).map(decodeDailySummary)
  }

  getDailySummary(date) {
    const row = this.db.prepare('SELECT * FROM daily_summaries WHERE summary_date = ?').get(String(date))
    return row ? decodeDailySummary(row) : null
  }

  listDailySummaries(month) {
    const rows =
      this.db
        .prepare('SELECT * FROM daily_summaries WHERE substr(summary_date, 1, 7) = ? ORDER BY summary_date')
        .all(String(month)) || []
    return rows.map(decodeDailySummary)
  }

  deleteDailySummary(date) {
    this.db.prepare('DELETE FROM daily_summaries WHERE summary_date = ?').run(String(date))
  }

  saveDailySummary(input) {
    const { date } = input
    const now = new Date().toISOString()
    const encode = (v) => JSON.stringify(v ?? null)
    this.db
      .prepare(
        `INSERT INTO daily_summaries
           (id, summary_date, overview, achievements, decisions, blockers, next_actions, metrics, source_references, status, generated_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
         ON CONFLICT(summary_date) DO UPDATE SET
           overview = excluded.overview,
           achievements = excluded.achievements,
           decisions = excluded.decisions,
           blockers = excluded.blockers,
           next_actions = excluded.next_actions,
           metrics = excluded.metrics,
           source_references = excluded.source_references,
           status = 'ready',
           updated_at = excluded.updated_at`,
      )
      .run(
        `day:${date}`, String(date),
        input.overview ?? null, encode(input.achievements), encode(input.decisions),
        encode(input.blockers), encode(input.nextActions), encode(input.metrics),
        encode(input.sources), now, now,
      )
    return this.getDailySummary(date)
  }

  /** Deterministic input for a daily AI summary: day events + sources + metrics. */
  dayAnalysisInput(date, projectId) {
    const allEvents = this.dayEvents(date, projectId)
    const statusMap = this.requirementStatusMap()
    const weekStart = this.weekStartIso()
    const events = allEvents.filter((e) => {
      if (e.sourceType !== 'milestone') return true
      const serial = String(e.title ?? '').split(' ')[0]
      return !this.isRetiredRequirement(serial, date, statusMap, weekStart)
    })
    const byType = {}
    const hhmm = (iso) => {
      const d = new Date(iso)
      return Number.isNaN(d.getTime())
        ? null
        : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    const detail =
      this.db
        .prepare(
          `SELECT source_type, occurred_at, raw_json FROM work_items
           WHERE local_date = ? AND source_type IN ('attendance','worklog')`,
        )
        .all(String(date)) || []
    let checkIn = null
    let checkOut = null
    let worklogHours = 0
    let worklogEntries = 0
    for (const r of detail) {
      if (r.source_type === 'attendance') {
        const t = hhmm(r.occurred_at)
        if (t) {
          if (!checkIn || t < checkIn) checkIn = t
          if (!checkOut || t > checkOut) checkOut = t
        }
      } else if (r.source_type === 'worklog') {
        try {
          const raw = JSON.parse(r.raw_json || '{}')
          worklogHours += Number(raw.actualTime) || 0
        } catch {}
        worklogEntries += 1
      }
    }
    const sources = []
    for (const e of events) {
      byType[e.sourceType] = (byType[e.sourceType] ?? 0) + 1
      sources.push({
        sourceType: e.sourceType, itemId: e.id, title: e.title, timestamp: e.time,
      })
    }
    const projects = [...new Set(events.flatMap((e) => e.projects))]
    const meetingRows =
      this.db
        .prepare(
          `SELECT title, raw_json, source_type FROM work_items
           WHERE local_date = ? AND source_type IN ('minutes','calendar_event')`,
        )
        .all(String(date)) || []
    const hasMinutes = meetingRows.some((m) => m.source_type === 'minutes')
    const meetings = meetingRows
      .filter((m) => {
        if (m.source_type !== 'calendar_event' || !hasMinutes) return true
        // 日程标题无信息量且当天已有听记时，避免与纪要重复展示
        return !/预定的会议|视频会议|会议$/.test(String(m.title ?? ''))
      })
      .map((m) => {
      let raw = {}
      try { raw = JSON.parse(m.raw_json ?? '{}') } catch {}
      return {
        title: m.title,
        summary: raw.summary ? String(raw.summary).replace(/[#*>`>\-|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : null,
        actions: (raw.actions ?? []).slice(0, 6),
        keywords: (raw.keywords ?? []).slice(0, 6),
        durationMinutes: raw.durationMinutes ?? null,
      }
    })
    const milestones = events.filter((e) => e.sourceType === 'milestone').map((e) => e.title)
    return {
      date,
      milestones,
      meetings,
      byPerson: this.byPersonInput({ start: String(date), end: String(date) }),
      metrics: {
        total: events.length,
        byType,
        projects,
        checkIn,
        checkOut: checkOut === checkIn ? null : checkOut,
        worklogHours: Math.round(worklogHours * 10) / 10,
        worklogEntries,
      },
      events,
      sources,
    }
  }

  /* ------------------------------ settings ------------------------------- */

  getSetting(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(String(key))
    return row ? row.value : fallback
  }

  setSetting(key, value) {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(String(key), value === null || value === undefined ? null : String(value), new Date().toISOString())
  }

  /* ----------------------------- efficiency ------------------------------ */

  /** weekday(1=Mon..7=Sun) x hour activity matrix within a date range. */
  dowHourMatrix(startDate, endDate, actors) {
    const mine = this.mineActivityClause(actors)
    const where = mine
      ? `WHERE local_date >= ? AND local_date <= ? AND local_hour IS NOT NULL AND ${mine.sql}`
      : 'WHERE local_date >= ? AND local_date <= ? AND local_hour IS NOT NULL'
    const params = mine ? [startDate, endDate, ...mine.params] : [startDate, endDate]
    const rows =
      this.db
        .prepare(
          `SELECT local_date, local_hour, COUNT(*) AS n FROM work_items
           ${where}
           GROUP BY local_date, local_hour`,
        )
        .all(...params) || []
    const matrix = Array.from({ length: 7 }, () => Array(24).fill(0))
    for (const r of rows) {
      const [y, m, dd] = String(r.local_date).split('-').map(Number)
      const dow = ((new Date(y, m - 1, dd).getDay() + 6) % 7) // 0=Mon
      const hour = Math.min(23, Math.max(0, r.local_hour))
      matrix[dow][hour] += r.n
    }
    return matrix
  }

  hourHistogram(startDate, endDate, actors) {
    const mine = this.mineActivityClause(actors)
    const where = mine
      ? `WHERE local_date >= ? AND local_date <= ? AND local_hour IS NOT NULL AND ${mine.sql}`
      : 'WHERE local_date >= ? AND local_date <= ? AND local_hour IS NOT NULL'
    const params = mine ? [startDate, endDate, ...mine.params] : [startDate, endDate]
    const rows =
      this.db
        .prepare(
          `SELECT local_hour, COUNT(*) AS n FROM work_items
           ${where}
           GROUP BY local_hour ORDER BY local_hour`,
        )
        .all(...params) || []
    const hist = Array(24).fill(0)
    for (const r of rows) hist[Math.min(23, Math.max(0, r.local_hour))] = r.n
    return hist
  }

  /** 时段分布悬浮明细：每小时的提交（按需求号聚合，Top3）与聊天采样（≤2 条），区间聚合。
   *  传入 actors 时只统计该名单的活动（commit/聊天为多人数据，必须过滤）。 */
  hourDetails(startDate, endDate, actors) {
    const mine = this.mineActivityClause(actors)
    const detail = Array.from({ length: 24 }, () => ({ reqs: new Map(), chats: [] }))
    const commitWhere = mine
      ? `WHERE local_date >= ? AND local_date <= ? AND local_hour IS NOT NULL AND source_type = 'commit' AND title != '' AND ${mine.sql}`
      : "WHERE local_date >= ? AND local_date <= ? AND local_hour IS NOT NULL AND source_type = 'commit' AND title != ''"
    const commitParams = mine ? [startDate, endDate, ...mine.params] : [startDate, endDate]
    const commitRows =
      this.db
        .prepare(
          `SELECT local_hour, title FROM work_items
           ${commitWhere}`,
        )
        .all(...commitParams) || []
    for (const r of commitRows) {
      const h = Math.min(23, Math.max(0, r.local_hour))
      const m = REQ_RE.exec(String(r.title ?? ''))
      const serial = m ? m[1] : '其他提交'
      const bucket = detail[h].reqs
      const prev = bucket.get(serial)
      if (prev) prev.n += 1
      else bucket.set(serial, { n: 1, title: String(r.title).slice(0, 60) })
    }
    const chatWhere = mine
      ? `WHERE local_date >= ? AND local_date <= ? AND local_hour IS NOT NULL AND source_type = 'chat_message' AND title != '' AND ${mine.sql}
         ORDER BY local_date DESC, occurred_at DESC LIMIT 600`
      : `WHERE local_date >= ? AND local_date <= ? AND local_hour IS NOT NULL
             AND source_type = 'chat_message' AND title != ''
           ORDER BY local_date DESC, occurred_at DESC LIMIT 600`
    const chatParams = mine ? [startDate, endDate, ...mine.params] : [startDate, endDate]
    const chatRows =
      this.db
        .prepare(
          `SELECT local_hour, actor, title FROM work_items
           ${chatWhere}`,
        )
        .all(...chatParams) || []
    for (const r of chatRows) {
      const h = Math.min(23, Math.max(0, r.local_hour))
      if (detail[h].chats.length >= 2) continue
      detail[h].chats.push({ sender: r.actor ?? '', text: String(r.title).slice(0, 50) })
    }
    return detail.map((d, hour) => ({
      hour,
      reqs: [...d.reqs.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 3).map(([serial, v]) => ({ serial, count: v.n, title: v.title })),
      chats: d.chats,
    }))
  }

  topActors(startDate, endDate, limit = 10) {
    return (
      this.db
        .prepare(
          `SELECT actor, COUNT(*) AS n FROM work_items
           WHERE local_date >= ? AND local_date <= ? AND actor IS NOT NULL AND actor != ''
           GROUP BY actor ORDER BY n DESC LIMIT ?`,
        )
        .all(startDate, endDate, Math.min(50, Math.max(1, limit))) || []
    )
  }

  /* -------------------------- range analytics --------------------------- */

  rangeCounts(startDate, endDate, actors) {
    const mine = this.mineActivityClause(actors)
    const where = mine
      ? `WHERE local_date >= ? AND local_date <= ? AND ${mine.sql}`
      : 'WHERE local_date >= ? AND local_date <= ?'
    const params = mine ? [startDate, endDate, ...mine.params] : [startDate, endDate]
    const rows =
      this.db
        .prepare(
          `SELECT source_type, COUNT(*) AS n FROM work_items
           ${where}
           GROUP BY source_type`,
        )
        .all(...params) || []
    return Object.fromEntries(rows.map((r) => [r.source_type, r.n]))
  }

  activeProjectsCount(startDate, endDate) {
    return (
      (this.db
        .prepare(
          `SELECT COUNT(DISTINCT l.entity_id) AS n FROM entity_links l
           JOIN work_items w ON w.id = l.item_id
           WHERE w.local_date >= ? AND w.local_date <= ?`,
        )
        .get(startDate, endDate) || {}).n ?? 0
    )
  }

  close() {
    try {
      this.db.close()
    } catch {}
  }
}

export function dayIso(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function decodeProject(row) {
  let rules = {}
  try {
    rules = JSON.parse(row.aliases || '{}')
  } catch {}
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    origin: row.origin,
    rules: {
      aliases: rules.aliases ?? [],
      keywords: rules.keywords ?? [],
      chatIds: rules.chatIds ?? [],
      externalId: rules.externalId ?? null,
    },
  }
}

function decodeAnalysis(row) {
  const parse = (text, fallback) => {
    try { return JSON.parse(text) } catch { return fallback }
  }
  return {
    id: row.id,
    kind: row.kind,
    scope: parse(row.scope, {}),
    payload: parse(row.payload, {}),
    sources: parse(row.sources, []),
    model: row.model,
    generatedAt: row.generated_at,
  }
}

function decodeDailySummary(row) {
  const parse = (text, fallback) => {
    try { return JSON.parse(text) } catch { return fallback }
  }
  return {
    id: row.id,
    date: row.summary_date,
    overview: row.overview,
    achievements: parse(row.achievements, []),
    decisions: parse(row.decisions, []),
    blockers: parse(row.blockers, []),
    nextActions: parse(row.next_actions, []),
    metrics: parse(row.metrics, {}),
    sources: parse(row.source_references, []),
    status: row.status,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
  }
}

function normalizeRow(r) {
  const occurred = r.occurred_at ?? new Date().toISOString()
  const d = new Date(occurred)
  const localDate = Number.isNaN(d.getTime())
    ? String(occurred).slice(0, 10)
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return {
    id: `${r.source_type}:${r.source_id}`,
    source_type: r.source_type,
    source_id: String(r.source_id),
    title: r.title ?? null,
    content: r.content ?? null,
    actor: r.actor ?? null,
    occurred_at: occurred,
    chat_id: r.chat_id ?? null,
    raw_json: r.raw_json ? JSON.stringify(r.raw_json) : null,
    fetched_at: new Date().toISOString(),
    local_date: localDate,
    local_hour: Number.isNaN(d.getTime()) ? 12 : d.getHours(),
  }
}
