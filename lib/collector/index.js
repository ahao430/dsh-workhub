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
    // 无截止时间的待办：沿用库里已存的 occurred_at（否则每次同步都漂移到“今天”，污染时间轴）
    const existingOccurred = new Map(
      db.listWorkItems({ sourceType: 'todo', limit: 200 }).map((r) => [r.source_id, r.occurred_at]),
    )
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
            : (existingOccurred.get(t.taskId) ?? nowIso()),
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

/** 从听记 +detail 响应里抽出摘要 / 关键词 / 行动项 */
function parseMinutesDetail(d) {
  const full = d?.summary?.result?.fullSummary
    ?? d?.summary?.result?.summary
    ?? d?.summary?.summary
    ?? null
  const keywords = d?.keywords?.result?.keywords ?? d?.keywords?.keywords ?? []
  const rawActions = d?.todos?.result?.actions ?? d?.todos?.actions ?? []
  const actions = (rawActions ?? [])
    .map((a) => {
      if (typeof a === 'string') {
        try { return JSON.parse(a)?.value ?? a } catch { return a }
      }
      return a?.value ?? a?.text ?? null
    })
    .filter(Boolean)
  return { summary: full ? String(full) : null, keywords: Array.isArray(keywords) ? keywords : [], actions }
}

export const minutesCollector = {
  source: 'dws.minutes',
  initialDays: 90,
  async collect({ db, dws }) {
    const out = await dws.executor.execute(['minutes', '+list-mine', '--limit', '100'])
    const minutes = out?.data?.minutes ?? []

    // 已拿到详情的听记（raw_json.detailFetched）——必须取 raw_json 列，否则增量判断失效退化为全量重拉
    const existing = new Map()
    for (const row of db.listWorkItems({ sourceType: 'minutes', limit: 200, withRaw: true })) {
      let raw = {}
      try { raw = JSON.parse(row.raw_json ?? '{}') } catch {}
      existing.set(row.source_id, raw)
    }

    // 批量补详情（每次最多 50 个）
    const needDetail = minutes
      .filter((m) => !existing.get(m.taskUuid)?.detailFetched)
      .map((m) => m.taskUuid)
    const detailMap = new Map()
    let detailError = null
    for (let i = 0; i < needDetail.length; i += 50) {
      const batch = needDetail.slice(i, i + 50)
      try {
        const results = await dws.fetchMinutesDetails(batch)
        for (const r of results) {
          const uuid = r?.taskUuid
          if (uuid) detailMap.set(uuid, parseMinutesDetail(r))
        }
      } catch (e) {
        detailError = String(e?.message || e).slice(0, 160)
      }
    }

    const rows = minutes.map((m) => {
      const prev = existing.get(m.taskUuid) ?? {}
      const detail = detailMap.get(m.taskUuid)
      const raw = {
        ...m,
        ...(detail ? { detailFetched: true, summary: detail.summary, keywords: detail.keywords, actions: detail.actions } : prev.detailFetched ? {
          detailFetched: true, summary: prev.summary, keywords: prev.keywords, actions: prev.actions,
        } : {}),
      }
      return {
        source_type: 'minutes',
        source_id: m.taskUuid,
        title: m.title,
        content: raw.summary ? String(raw.summary).replace(/[#*>\-|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200) : null,
        actor: m.flashUserInfo?.name ?? null,
        occurred_at: m.startTime ? new Date(Number(m.startTime)).toISOString() : nowIso(),
        raw_json: raw,
      }
    })
    return {
      upserted: db.upsertWorkItems(rows),
      fetched: rows.length,
      detail: { withDetail: detailMap.size, pending: needDetail.length - detailMap.size, error: detailError },
    }
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
  initialDays: 31, // 首次回填窗口；之后按 sync_state.cursor 增量（当天始终重拉，补卡也会进来）
  async collect({ db, dws }) {
    const health = await dws.getHealth()
    if (!health.authenticated || !health.userId) throw new Error('dws not authenticated')
    // 增量窗口：cursor 为已覆盖到的日期（含）。本次拉 cursor 之后 ~ 今天（今天打卡会累积，始终重拉）；
    // 无游标 / 游标早于回填窗口 → 全量回填 initialDays 天。
    const fmtIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const todayIso = fmtIso(new Date())
    const oldest = dayStr(this.initialDays - 1)
    const prev = db.getSyncState ? db.getSyncState(this.source) : null
    const cursor = (prev?.cursor && String(prev.cursor) >= oldest) ? String(prev.cursor) : null
    const dates = []
    for (let d = new Date(`${oldest}T00:00:00`); fmtIso(d) <= todayIso; d.setDate(d.getDate() + 1)) {
      const iso = fmtIso(d)
      if (!cursor || iso > cursor) dates.push(iso)
    }
    const rows = []
    const failedDays = []
    let attempted = 0
    for (const date of dates) {
      attempted++
      // 单日失败不再静默：记入 failedDays，sync_state 显示 partial；全部失败才整源报错
      const result = await dws.fetchAttendanceDay(date, health.userId).catch(() => null)
      if (result === null) { failedDays.push(date); continue }
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
    if (attempted > 0 && failedDays.length === attempted) {
      throw new Error(`attendance ${attempted} 天全部拉取失败（${failedDays[0]} ~ ${failedDays[failedDays.length - 1]}）`)
    }
    const allOk = failedDays.length === 0
    return {
      upserted: db.upsertWorkItems(rows),
      fetched: rows.length,
      // 有失败日时不推进 cursor（upsert 幂等，下次同步自动重试缺口）
      ...(allOk ? { cursor: todayIso } : {
        syncStatus: 'partial',
        detail: { days: attempted, failedDays: failedDays.slice(0, 8) },
      }),
    }
  },
}

/* ------------------------------ calendar -------------------------------- */

export const calendarCollector = {
  source: 'dws.calendar',
  initialDays: 30,
  async collect({ db, dws }) {
    const start = new Date(Date.now() - this.initialDays * 86_400_000)
    start.setHours(0, 0, 0, 0)
    const end = new Date(Date.now() + 14 * 86_400_000) // 也取未来两周的会议安排
    end.setHours(23, 59, 59, 0)
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00+08:00`
    const events = await dws.listAgenda({ startIso: iso(start), endIso: iso(end) })
    const rows = (events ?? []).map((e) => {
      const startIso = e.start?.dateTime ?? null
      const endIso = e.end?.dateTime ?? null
      const minutes = startIso && endIso
        ? Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000)
        : null
      const attendees = (e.attendees ?? []).map((a) => a.displayName ?? a.name).filter(Boolean)
      return {
        source_type: 'calendar_event',
        source_id: String(e.eventId),
        title: e.summary ?? e.title ?? '(会议)',
        content: [
          minutes ? `时长 ${minutes} 分钟` : null,
          attendees.length ? `参会人：${attendees.slice(0, 8).join('、')}` : null,
        ].filter(Boolean).join(' · ') || null,
        actor: e.organizer?.displayName ?? e.organizer?.name ?? null,
        occurred_at: startIso ?? nowIso(),
        raw_json: { ...e, durationMinutes: minutes, attendeeNames: attendees },
      }
    })
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

export const allCollectors = [todoCollector, reportCollector, minutesCollector, chatsCollector, attendanceCollector, calendarCollector]
