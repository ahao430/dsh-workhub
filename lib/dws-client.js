/**
 * DwsClient — business methods over the dws CLI, verified against the local
 * dws command catalog (2026-11). Every argv is generated here from whitelisted
 * argument slots; user input is never concatenated into a command string.
 */
import { DwsExecutor } from './dws-executor.js'

/** Values must not look like flags. */
function arg(value, name) {
  const s = String(value ?? '')
  if (!s || s.startsWith('-')) throw new Error(`invalid ${name}`)
  return s
}

function num(value, name) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1 || n > 200) throw new Error(`invalid ${name}`)
  return String(Math.floor(n))
}

/** RFC3339 / ISO-8601 timestamp, e.g. 2026-11-01T00:00:00+08:00 */
function isoArg(value, name) {
  const s = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*$/.test(s)) throw new Error(`invalid ${name} (expect ISO-8601)`)
  return s
}

function dateArg(value, name) {
  const s = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/.test(s)) throw new Error(`invalid ${name}`)
  return s
}

export class DwsClient {
  constructor(options = {}) {
    this.executor = options.executor ?? new DwsExecutor(options)
  }

  /** Probe CLI + auth in one call. */
  async getHealth() {
    const out = await this.executor.runRaw(['auth', 'status', '--format', 'json'])
    return {
      authenticated: !!out.authenticated,
      tokenValid: out.token_valid !== false,
      refreshTokenValid: out.refresh_token_valid !== false,
      corpId: out.corp_id,
      corpName: out.corp_name,
      userId: out.user_id,
      userName: out.user_name,
      expiresAt: out.expires_at,
      refreshExpiresAt: out.refresh_expires_at,
    }
  }

  /** Current DWS profile (multi-account support). */
  async getProfile() {
    const out = await this.executor.runRaw(['profile', 'list', '--format', 'json'])
    return out
  }

  /** One day's personal attendance records (check-in/out times & locations). */
  async fetchAttendanceDay(date, userId) {
    const out = await this.executor.execute([
      'attendance', 'record', 'get', '--date', dateArg(date, 'date'), '--user', arg(userId, 'userId'),
    ])
    return out?.result ?? out
  }

  getVersion() {
    return this.executor.runRaw(['--version'])
  }

  /* ------------------------------ todos ------------------------------ */

  async listTodos({ size = 20 } = {}) {
    const out = await this.executor.execute([
      'todo', '+get-my-tasks', '--size', num(size, 'size'),
    ])
    const data = out?.data ?? out
    return (data?.todos ?? []).map((t) => ({
      taskId: t.taskId,
      subject: t.subject,
      dueTime: t.dueTime ? new Date(Number(t.dueTime)).toISOString() : null,
      priority: t.priority,
      done: t.finalStatusStage === 2,
      raw: t,
    }))
  }

  async listOverdueTodos() {
    const out = await this.executor.execute(['todo', '+overdue'])
    const data = out?.data ?? out
    return (data?.todos ?? data?.result ?? []).map((t) => ({
      taskId: t.taskId,
      subject: t.subject,
      dueTime: t.dueTime ? new Date(Number(t.dueTime)).toISOString() : null,
      done: false,
      raw: t,
    }))
  }

  /* ----------------------------- reports ----------------------------- */

  async listSentReports({ start, end } = {}) {
    const args = ['report', 'outbox', 'list']
    if (start) args.push('--start', dateArg(start, 'start'))
    if (end) args.push('--end', dateArg(end, 'end'))
    const out = await this.executor.execute(args)
    const rows = out?.result ?? []
    const details = out?._internalDetailCommands ?? []
    return rows.map((row, i) => {
      const meta = details.find((d) => d.index === i + 1) ?? {}
      return {
        reportId: extractReportId(meta.command),
        title: meta.title ?? row['模板'] ?? row['标题'] ?? `日志 ${i + 1}`,
        sender: row['发送人'],
        submittedAt: row['提交时间'] ?? row['时间'],
        contentPreview: truncate(stripHtml(String(row['日志内容'] ?? '')), 200),
        raw: row,
      }
    })
  }

  async getReportDetail(reportId) {
    const out = await this.executor.execute([
      'report', 'entry', 'get', '--report-id', arg(reportId, 'reportId'),
    ])
    return out?.data ?? out
  }

  /* ------------------------------ chat ------------------------------- */

  async listUnreadChats() {
    const out = await this.executor.execute(['chat', '+unread-chats'])
    const data = out?.data ?? out
    return data?.conversations ?? []
  }

  async listRecentChats({ since, timeoutMs = 180_000 } = {}) {
    // +recent-conversations: --start/--end window (not --since); a 30-day
    // window takes over a minute, so callers may raise the timeout.
    const args = ['chat', '+recent-conversations']
    if (since) args.push('--start', dateArg(since, 'since'))
    const out = await this.executor.execute(args, { timeoutMs })
    return out?.data?.conversations ?? out?.conversations ?? []
  }

  async listMentions({ since } = {}) {
    const args = ['chat', '+at-me']
    if (since) args.push('--since', dateArg(since, 'since'))
    const out = await this.executor.execute(args)
    return out?.data ?? out
  }

  /**
   * Read one conversation's messages in a [start, end) window.
   * dws +chat-messages: bounded pages, stable messageId, typed nextPage.
   */
  async fetchChatMessages({ conversationId, name, start, end, limit = 50, order = 'desc' }) {
    const args = ['chat', '+chat-messages']
    if (conversationId) args.push('--conversation-id', arg(conversationId, 'conversationId'))
    else if (name) args.push('--group', arg(name, 'group'))
    else throw new Error('conversationId or name required')
    if (start) args.push('--start', dateArg(start, 'start'))
    if (end) args.push('--end', dateArg(end, 'end'))
    args.push('--order', order === 'asc' ? 'asc' : 'desc', '--limit', num(limit, 'limit'))
    const out = await this.executor.execute(args)
    const data = out?.data ?? out
    return {
      messages: data?.messages ?? [],
      hasMore: !!data?.hasMore,
      nextPage: data?.nextPage ?? null,
      complete: data?.complete !== false,
      stopReason: data?.stopReason ?? null,
    }
  }

  /* ----------------------------- calendar ---------------------------- */

  /** Calendar events in an ISO range (default: today). */
  async listAgenda({ startIso, endIso } = {}) {
    const args = ['calendar', '+agenda']
    if (startIso) args.push('--start', isoArg(startIso, 'start'))
    if (endIso) args.push('--end', isoArg(endIso, 'end'))
    const out = await this.executor.execute(args)
    const data = out?.data ?? out
    return data?.events ?? []
  }

  /* ----------------------------- minutes ----------------------------- */

  /** Batch meeting-notes detail: fullSummary + keywords + action items (max 50 ids). */
  async fetchMinutesDetails(ids, { timeoutMs = 180_000 } = {}) {
    const list = (ids ?? []).slice(0, 50).map((x) => arg(x, 'minutesId'))
    if (!list.length) return []
    const out = await this.executor.executeTolerant([
      'minutes', '+detail', '--ids', list.join(','),
      '--artifacts', 'summary,keywords,todos',
    ], { timeoutMs })
    const rows = Array.isArray(out) ? out : (out?.results ?? out?.data?.items ?? out?.items ?? [out])
    return rows.filter(Boolean)
  }

  async listMinutes({ limit = 20 } = {}) {
    const out = await this.executor.execute([
      'minutes', '+list-mine', '--limit', num(limit, 'limit'),
    ])
    const data = out?.data ?? out
    return (data?.minutes ?? []).map((m) => ({
      taskUuid: m.taskUuid,
      title: m.title,
      startTime: m.startTime ? new Date(Number(m.startTime)).toISOString() : null,
      status: m.status,
      url: m.url,
      owner: m.flashUserInfo?.name,
    }))
  }
}

function extractReportId(command) {
  const m = /--report-id\s+(\S+)/.exec(String(command ?? ''))
  return m ? m[1] : null
}

function stripHtml(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#*]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(text, n) {
  return text.length > n ? `${text.slice(0, n)}…` : text
}
