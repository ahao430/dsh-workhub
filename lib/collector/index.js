/**
 * Collectors — pull each DingTalk source into work_items via DwsClient.
 * Every collector is { source, initialDays, collect(ctx) } where ctx is
 * { db: WorkHubDB, dws: DwsClient }. Results are upserted with the
 * source_type+source_id uniqueness key; state changes update in place
 * (per v2 §10.2).
 */

const nowIso = () => new Date().toISOString()
const dayStr = (offsetDays) =>
  new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10)

/* ------------------------------- todos ---------------------------------- */

export const todoCollector = {
  source: 'dws.todo',
  initialDays: 30,
  async collect({ db, dws }) {
    // Backend caps page size at 20; walk pages until a short page.
    const seen = new Set()
    const rows = []
    for (let page = 1; page <= 10; page++) {
      const out = await dws.executor.execute([
        'todo', '+get-my-tasks', '--size', '20', '--page', String(page),
      ])
      const todos = out?.data?.todos ?? []
      for (const t of todos) {
        if (seen.has(t.taskId)) continue
        seen.add(t.taskId)
        rows.push({
          source_type: 'todo',
          source_id: t.taskId,
          title: t.subject,
          actor: null,
          occurred_at: t.dueTime
            ? new Date(Number(t.dueTime)).toISOString()
            : nowIso(),
          raw_json: t,
        })
      }
      if (todos.length < 20) break
    }
    const n = db.upsertWorkItems(rows)
    return {
      upserted: n,
      fetched: rows.length,
      detail: { open: rows.filter((r) => r.raw_json.finalStatusStage !== 2).length },
    }
  },
}

/* ------------------------------ reports --------------------------------- */

export const reportCollector = {
  source: 'dws.report',
  initialDays: 90,
  async collect({ db, dws }) {
    // Server caps single-query span at 20 days; walk 20-day windows.
    let upserted = 0
    let fetched = 0
    for (let offset = this.initialDays; offset > 0; offset -= 20) {
      const start = dayStr(Math.min(offset, this.initialDays))
      const end = dayStr(Math.max(offset - 20, 0))
      if (start >= end) continue
      const out = await dws.executor.execute([
        'report', 'outbox', 'list', '--start', `${start} 00:00:00`, '--end', `${end} 23:59:59`,
      ])
      const rows = out?.result ?? []
      const details = out?._internalDetailCommands ?? []
      const items = rows.map((row, i) => {
        const meta = details.find((d) => d.index === i + 1) ?? {}
        const reportId = extractReportId(meta.command) ?? `${start}#${i}`
        const when = row['提交时间'] ?? row['创建时间'] ?? row['时间'] ?? `${end} 12:00:00`
        return {
          source_type: 'report',
          source_id: reportId,
          title: meta.title ?? row['模板'] ?? row['标题'] ?? `日志 ${i + 1}`,
          content: truncate(String(row['日志内容'] ?? ''), 2000),
          actor: row['发送人'] ?? null,
          occurred_at: parseLocal(when) ?? nowIso(),
          raw_json: row,
        }
      })
      fetched += items.length
      upserted += db.upsertWorkItems(items)
    }
    return { upserted, fetched }
  },
}

/* ------------------------------ minutes --------------------------------- */

export const minutesCollector = {
  source: 'dws.minutes',
  initialDays: 90,
  async collect({ db, dws }) {
    const out = await dws.executor.execute(['minutes', '+list-mine', '--limit', '100'])
    const minutes = out?.data?.minutes ?? []
    const rows = minutes.map((m) => ({
      source_type: 'minutes',
      source_id: m.taskUuid,
      title: m.title,
      actor: m.flashUserInfo?.name ?? null,
      occurred_at: m.startTime ? new Date(Number(m.startTime)).toISOString() : nowIso(),
      raw_json: m,
    }))
    return { upserted: db.upsertWorkItems(rows), fetched: rows.length }
  },
}

/* -------------------------- chat registry ------------------------------- */

export const chatsCollector = {
  source: 'dws.chats',
  initialDays: 30,
  async collect({ db, dws }) {
    const conversations = await dws.listRecentChats({ since: `${dayStr(this.initialDays)} 00:00:00` })
    const rows = conversations
      .filter((c) => c && c.conversationId)
      .map((c) => ({
        conversation_id: c.conversationId,
        name: c.name ?? null,
        type: c.type ?? null,
        latest_message_time: c.latestMessageTime ?? null,
      }))
    const upserted = db.upsertChats(rows)
    return { upserted, fetched: rows.length }
  },
}

/* --------------------- chat messages (on demand) ------------------------ */

export async function collectChatMessages({ db, dws, conversationId, sinceDays = 14 }) {
  const since = `${dayStr(sinceDays)} 00:00:00`
  const { messages, hasMore, complete, stopReason } = await dws.fetchChatMessages({
    conversationId,
    start: since,
    limit: 100,
  })
  const rows = messages.map((m) => ({
    source_type: 'chat_message',
    source_id: m.messageId,
    title: truncate(plainText(m.text), 80),
    content: plainText(m.text),
    actor: m.sender ?? m.senderId ?? null,
    occurred_at: parseLocal(m.createTime) ?? nowIso(),
    chat_id: m.conversationId ?? conversationId,
    raw_json: m,
  }))
  const upserted = db.upsertWorkItems(rows)
  db.markChatCollected(conversationId)
  db.setSyncState(`dws.chat:${conversationId}`, {
    status: complete ? 'ok' : 'partial',
    totalSynced: upserted,
    error: complete ? null : `stopReason=${stopReason ?? 'unknown'} hasMore=${hasMore}`,
  })
  return { upserted, fetched: rows.length, complete, hasMore, stopReason }
}

/* ----------------------------- attendance ------------------------------- */

export const attendanceCollector = {
  source: 'dws.attendance',
  initialDays: 31, // per-day API call; ~30s for a month
  async collect({ db, dws }) {
    const health = await dws.getHealth()
    if (!health.authenticated || !health.userId) throw new Error('dws not authenticated')
    const rows = []
    for (let i = 0; i < this.initialDays; i++) {
      const date = dayStr(i)
      const result = await dws.fetchAttendanceDay(date, health.userId).catch(() => null)
      const records = result?.recordList ?? []
      for (const r of records) {
        if (!r?.userCheckTime) continue
        rows.push({
          source_type: 'attendance',
          source_id: `${date}:${r.planCheckTime}:${r.checkTypeDesc}`,
          title: `${r.checkTypeDesc ?? '打卡'}${r.locationText ? ` · ${r.locationText}` : ''}`,
          content: r.isNormal === false ? '异常打卡' : null,
          actor: health.userName,
          occurred_at: new Date(Number(r.userCheckTime)).toISOString(),
          raw_json: r,
        })
      }
    }
    return { upserted: db.upsertWorkItems(rows), fetched: rows.length }
  },
}

/* ------------------------------ helpers --------------------------------- */

function extractReportId(command) {
  const m = /--report-id\s+(\S+)/.exec(String(command ?? ''))
  return m ? m[1] : null
}

function plainText(text) {
  return String(text ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(text, n) {
  const s = String(text ?? '')
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/** dws local times are "YYYY-MM-DD HH:mm:ss" in the host timezone (Asia/Shanghai). */
function parseLocal(value) {
  if (!value) return null
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(value))
  if (!m) return null
  const d = new Date(`${m[1]}T${m[2]}+08:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export const allCollectors = [todoCollector, reportCollector, minutesCollector, chatsCollector, attendanceCollector]
