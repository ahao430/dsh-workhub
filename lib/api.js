/**
 * WorkHub HTTP API — same-origin read/collect routes under /api/workhub.
 * M2 scope: sync, raw item browsing, deterministic stats only (no LLM).
 */
import { DwsClient } from './dws-client.js'
import { WorkHubDB } from './storage/db.js'
import { SyncManager } from './collector/sync-manager.js'
import { resolveRange, bucketOf, PRESETS } from './time.js'
import { CredentialStore } from './security/credential-store.js'
import { DingTalkLogin } from './auth/dingtalk-login.js'

const TYPE_NAME = {
  todo: '待办', report: '日志', minutes: '会议', chat_message: '消息', attendance: '打卡',
  commit: '提交', requirement: '需求', task: '任务', pipeline: '流水线', worklog: '报工',
  milestone: '排期节点', git_repo: '仓库', yunxiao_project: '云效项目', calendar_event: '日程',
}
function typeName(t) {
  return TYPE_NAME[t] ?? t
}

function readYunxiaoConfig(db) {
  const configured = !!db.getSetting('yunxiao.baseUrl')
  return {
    configured,
    instanceType: db.getSetting('yunxiao.instanceType', 'region'),
    baseUrl: db.getSetting('yunxiao.baseUrl'),
    organizationId: db.getSetting('yunxiao.organizationId'),
    credentialRef: db.getSetting('yunxiao.credentialRef'),
  }
}

function capabilityMatrix(sync, db) {
  return sync.listSources().map(({ source, state }) => ({
    capability: source,
    status: !state ? 'unknown' : state.status === 'ok' ? 'available' : state.status === 'error' ? 'unavailable' : 'unknown',
    lastCheckedAt: state?.last_sync_at ?? null,
    error: state?.last_error ?? null,
  }))
}

export function createWorkHubRouter(options = {}) {
  const dws = options.dwsClient ?? new DwsClient(options)
  const db = options.db ?? new WorkHubDB(options.dbPath)
  const credentials = options.credentials ?? new CredentialStore()
  const dingtalkLogin = options.dingtalkLogin ?? new DingTalkLogin()
  const sync = new SyncManager({ db, dws, credentials })
  const prefix = options.prefix ?? '/api/workhub'

  const GET = {
    '/status': async (params) => {
      const health = await Promise.allSettled([dws.getHealth()])
      const h = health[0].status === 'fulfilled' ? health[0].value : { authenticated: false }
      return {
        plugin: 'workhub',
        db: { file: db.filePath, items: db.countItems() },
        dws: h,
        time: new Date().toISOString(),
      }
    },

    '/sync/status': async () => {
      const counts = db.chatMessageCounts()
      return {
        sources: sync.listSources(),
        chats: db.listChats(200).map((c) => ({ ...c, messageCount: counts[c.conversation_id] ?? 0 })),
      }
    },

    '/items': async (params) => ({
      items: db.listWorkItems({
        sourceType: safeEnum(params.get('sourceType'), ['todo', 'report', 'minutes', 'chat_message', 'attendance', 'commit', 'requirement', 'task', 'pipeline', 'git_repo', 'yunxiao_project']),
        chatId: params.get('chatId') ?? undefined,
        limit: clampInt(params.get('limit'), 50, 1, 200),
        offset: clampInt(params.get('offset'), 0, 0, 10000),
      }),
    }),

    '/stats': async (params) => ({
      counts: db.countItems(),
      byDay: db.activityByDay(clampInt(params.get('days'), 14, 1, 90)),
    }),

    '/db': async () => ({ file: db.filePath, counts: db.countItems() }),

    '/analytics/dashboard': async (params) => {
      const range = resolveRange({
        preset: params.get('preset') ?? undefined,
        start: params.get('start') ?? undefined,
        end: params.get('end') ?? undefined,
        granularity: params.get('granularity') ?? undefined,
        compare: params.get('compare') === '1',
      })
      const byDay = db.activityRange(range.startDate, range.endDate)
      // bucket by granularity
      const buckets = {}
      for (const r of byDay) {
        const key = bucketOf(r.day, range.granularity)
        buckets[key] = buckets[key] || { bucket: key, source_type: r.source_type, n: 0 }
        buckets[key].n += r.n
      }

      // 每个 bucket 内提交涉及的需求号（趋势图 tooltip 用）
      const REQ_RE = /\b([A-Z]{2,6}PRO-\d+)\b/
      const commitRows = db.db
        .prepare("SELECT local_date, title FROM work_items WHERE source_type = 'commit' AND local_date >= ? AND local_date <= ?")
        .all(range.startDate, range.endDate) || []
      const reqByBucket = {}
      for (const r of commitRows) {
        const m = REQ_RE.exec(String(r.title ?? ''))
        if (!m) continue
        const key = bucketOf(r.local_date, range.granularity)
        reqByBucket[key] = reqByBucket[key] || new Map()
        reqByBucket[key].set(m[1], (reqByBucket[key].get(m[1]) ?? 0) + 1)
      }
      const bucketRequirements = {}
      for (const [key, map] of Object.entries(reqByBucket)) {
        bucketRequirements[key] = [...map.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([serial, count]) => ({ serial, count }))
      }
      const result = {
        range,
        counts: db.rangeCounts(range.startDate, range.endDate),
        activity: Object.values(buckets).sort((a, b) => a.bucket.localeCompare(b.bucket)),
        bucketRequirements,
        projectActivity: db.projectActivityRange(range.startDate, range.endDate),
        activeProjects: db.activeProjectsCount(range.startDate, range.endDate),
        inProgress: db.inProgressRequirements({ start: range.startDate, end: range.endDate, limit: 8 }),
      }
      if (range.compare) {
        result.compare = {
          range: { startDate: range.prevStartDate, endDate: range.prevEndDate },
          counts: db.rangeCounts(range.prevStartDate, range.prevEndDate),
          activeProjects: db.activeProjectsCount(range.prevStartDate, range.prevEndDate),
        }
      }
      return result
    },

    '/calendar': async (params) => {
      const month = params.get('month') ?? new Date().toISOString().slice(0, 7)
      const projectId = params.get('projectId') ?? undefined
      if (projectId && !db.getProject(projectId)) throw httpError(404, 'project not found')
      return { month, days: db.calendarMonth(month, projectId) }
    },

    '/calendar/day': async (params) => {
      const date = params.get('date') ?? new Date().toISOString().slice(0, 10)
      const projectId = params.get('projectId') ?? undefined
      const input = db.dayAnalysisInput(date, projectId)
      return {
        ...input,
        summary: db.getDailySummary(date),
        inProgress: db.inProgressRequirements({ start: date, end: date, limit: 6, projectId }),
      }
    },

    /** 按项目分组的进行中需求（项目列表页）。 */
    '/analytics/inprogress/grouped': async (params) => {
      const range = resolveRange({
        preset: params.get('preset') ?? undefined,
        start: params.get('start') ?? undefined,
        end: params.get('end') ?? undefined,
      })
      const groups = db.inProgressRequirementsGrouped({ start: range.startDate, end: range.endDate })
      const nameOf = new Map(db.listProjects().map((p) => [p.id, p.name]))
      return {
        range,
        groups: groups.map((g) => ({ ...g, name: nameOf.get(g.projectId) ?? g.projectId.slice(0, 12) })),
      }
    },

    '/projects': async () => ({
      projects: db.listProjects(),
      resolve: null,
    }),

    '/analyses': async (params) => ({
      analyses: db.listAnalyses({
        kind: safeEnum(params.get('kind'), ['insight', 'topic_cluster', 'report_draft', 'project_summary', 'chat_summary']),
        projectId: params.get('projectId') ?? undefined,
        limit: clampInt(params.get('limit'), 50, 1, 200),
      }),
    }),

    '/analyses/input/project': async (params) => {
      const id = params.get('projectId') ?? ''
      if (!db.getProject(id)) throw httpError(404, 'project not found')
      return db.projectAnalysisInput(id, clampInt(params.get('days'), 14, 1, 90))
    },

    '/analyses/input/chat': async (params) => {
      const chatId = params.get('chatId') ?? ''
      if (!chatId) throw httpError(400, 'missing chatId')
      const input = db.chatAnalysisInput(chatId, clampInt(params.get('days'), 14, 1, 90))
      if (!input.stats.total) throw httpError(404, 'no collected messages for this chat (collect it first in 数据管理)')
      return input
    },

    '/analyses/input/day': async (params) => {
      const date = params.get('date') ?? new Date().toISOString().slice(0, 10)
      const projectId = params.get('projectId') ?? undefined
      return db.dayAnalysisInput(date, projectId)
    },

    '/analyses/input/report': async (params) => {
      const projectId = params.get('projectId') ?? undefined
      if (projectId && !db.getProject(projectId)) throw httpError(404, 'project not found')
      return db.reportInput({ projectId, days: clampInt(params.get('days'), 7, 1, 90) })
    },

    '/analytics/efficiency': async (params) => {
      const hasCustom = !!(params.get('start') && params.get('end'))
      const range = resolveRange({
        preset: hasCustom ? undefined : (params.get('preset') ?? 'last_30_days'),
        start: params.get('start') ?? undefined,
        end: params.get('end') ?? undefined,
      })
      return {
        range,
        matrix: db.dowHourMatrix(range.startDate, range.endDate),
        hourHistogram: db.hourHistogram(range.startDate, range.endDate),
        topActors: db.topActors(range.startDate, range.endDate),
      }
    },

    '/analytics/project': async (params) => {
      const projectId = params.get('projectId') ?? ''
      const project = db.getProject(projectId)
      if (!project) throw httpError(404, 'project not found')
      const range = resolveRange({
        preset: params.get('preset') ?? 'last_30_days',
        granularity: params.get('granularity') ?? undefined,
      })
      const activity = db
        .projectActivityRange(range.startDate, range.endDate)
        .filter((r) => r.id === projectId)
      const counts = {}
      let total = 0
      for (const r of activity) {
        counts[r.source_type] = r.n
        total += r.n
      }
      return {
        project,
        range,
        total,
        counts,
        insights: db.listAnalyses({ projectId }),
        factStats: db.projectFactStats(projectId, range.startDate, range.endDate),
        linkedItems: db.projectAnalysisInput(projectId, 90).grouped,
        inProgress: db.inProgressRequirements({ start: range.startDate, end: range.endDate, limit: 8, projectId }),
      }
    },

    '/time/presets': async () => ({ presets: PRESETS }),

    '/time/resolve': async (params) => ({
      range: resolveRange({
        preset: params.get('preset') ?? 'company_period',
        start: params.get('start') ?? undefined,
        end: params.get('end') ?? undefined,
        granularity: params.get('granularity') ?? undefined,
        compare: params.get('compare') === '1',
      }),
    }),

    '/summaries': async (params) => {
      const days = clampInt(params.get('days'), 60, 1, 365)
      const to = params.get('to') ?? new Date().toISOString().slice(0, 10)
      const from = params.get('from') ?? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
      return { summaries: db.listDailySummariesBetween(from, to), from, to }
    },

    '/summaries/export': async (params, req, res) => {
      const date = params.get('date') ?? ''
      const s = db.getDailySummary(date)
      if (!s) throw httpError(404, 'summary not found')
      const lines = [`# ${s.date} 每日工作总结`, '']
      if (s.overview) lines.push(s.overview, '')
      const section = (title, list) => {
        if (!list?.length) return
        lines.push(`## ${title}`, '')
        for (const x of list) lines.push(`- ${x}`)
        lines.push('')
      }
      section('重点工作', s.achievements)
      section('关键决策', s.decisions)
      section('待跟进', s.blockers)
      section('下一步', s.nextActions)
      const m = s.metrics ?? {}
      lines.push('## 指标', '')
      lines.push(`- 事件总数：${m.events ?? '—'}`)
      if (m.commits != null) lines.push(`- 代码提交：${m.commits}`)
      if (m.checkIn) lines.push(`- 打卡：${m.checkIn} – ${m.checkOut ?? '未打卡下班'}`)
      if (m.worklogHours) lines.push(`- 报工：${m.worklogHours}h`)
      if (m.projects?.length) lines.push(`- 项目：${m.projects.join(' / ')}`)
      lines.push('', '---', '', `来源依据 ${s.sources?.length ?? 0} 条 · 生成于 ${s.generatedAt}`)
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="workhub-daily-${s.date}.md"`,
      })
      res.end(lines.join('\n'))
      return null
    },

    '/analyses/export': async (params, req, res) => {
      const a = db.getAnalysis(params.get('id') ?? '')
      if (!a) throw httpError(404, 'analysis not found')
      const lines = []
      lines.push(`# ${a.payload?.title ?? a.kind}`, '')
      if (a.payload?.overview) lines.push(a.payload.overview, '')
      for (const sec of a.payload?.sections ?? []) {
        lines.push(`## ${sec.title}`, '', sec.content, '')
      }
      if (a.payload?.description && !a.payload?.sections) lines.push(a.payload.description, '')
      for (const t of a.payload?.topics ?? []) {
        lines.push(`## 话题：${t.name}（${t.status ?? ''}）`, '', t.summary ?? '', '')
      }
      lines.push('---', '', `生成时间：${a.generatedAt} · 来源依据 ${a.sources?.length ?? 0} 条：`, '')
      for (const src of a.sources ?? []) {
        lines.push(`- [${src.sourceType}] ${(src.title ?? src.sourceId ?? '').slice(0, 80)} (${src.timestamp ?? ''})`)
      }
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="workhub-${a.id.replace(/[^\w]/g, '')}.md"`,
      })
      res.end(lines.join('\n'))
      return null
    },

    '/actions/pipelines': async () => ({
      pipelines: db.listWorkItems({ sourceType: 'pipeline', limit: 100 }),
      actions: db.listActions(20),
    }),

    /* 应用交付（Appstack）：实时查询，不落库；部署写操作走 POST /actions/appstack/deploy */
    '/actions/appstack': async () => {
      const { YunxiaoClient } = await import('./yunxiao/client.js')
      try {
        const yx = new YunxiaoClient({ db, credentials })
        const apps = await yx.listApps()
        return {
          apps: apps.map((a) => ({
            name: a.name, description: a.description ?? '', template: a.appTemplateName ?? '', createdAt: a.gmtCreate ?? '',
          })),
        }
      } catch (e) {
        if (e.code === 'yunxiao-not-configured') return { apps: [], error: { code: e.code, message: '尚未配置云效 PAT（数据管理 → 云效）' } }
        if (e.code === 'yunxiao-permission-denied') return { apps: [], error: { code: e.code, message: '当前 PAT 缺少「应用交付」权限：云效 → 个人设置 → 个人访问令牌 → 编辑权限后重试' } }
        throw e
      }
    },

    '/actions/appstack/detail': async (params) => {
      const appName = String(params.get('app') ?? '')
      if (!/^[\w.-]+$/.test(appName)) throw httpError(400, 'invalid app name')
      const { YunxiaoClient } = await import('./yunxiao/client.js')
      const yx = new YunxiaoClient({ db, credentials })
      try {
        const [envs, orders, orch] = await Promise.all([
          yx.listAppEnvironments(appName),
          yx.listChangeOrders(appName, { pageSize: 10 }),
          yx.getLatestOrchestration(appName).catch(() => null),
        ])
        return {
          app: appName,
          envs: envs.map((e) => ({ name: e.name, displayName: e.descriptiveName ?? e.name, state: e.state ?? '', deployGroup: e.deployGroupName ?? '' })),
          orders: orders.map((o) => ({ name: o.name, type: o.type, state: o.state, version: o.version ?? '', createdAt: o.gmtCreate ?? '' })),
          orchestration: orch,
        }
      } catch (e) {
        if (e.code === 'yunxiao-permission-denied') return { app: appName, envs: [], orders: [], orchestration: null, error: { code: e.code, message: '当前 PAT 缺少「应用交付」对应权限' } }
        throw e
      }
    },

    /* 应用交付本地偏好（收藏/备注）：存本地 settings，不涉及上游 */
    '/actions/appstack/prefs': async () => {
      let prefs = {}
      try { prefs = JSON.parse(db.getSetting('appstack.prefs') ?? '{}') } catch { prefs = {} }
      return {
        favorites: Array.isArray(prefs.favorites) ? prefs.favorites : [],
        notes: prefs.notes && typeof prefs.notes === 'object' ? prefs.notes : {},
      }
    },

    /* --------------------------- data sources ---------------------------- */

    '/sources': async () => {
      const dingtalk = await dws
        .getHealth()
        .then((h) => {
          // 三态：connected（正常）/ refreshing（access 过期但可自动续期）/ expired（需重新扫码）
          let status = 'connected'
          if (!h.authenticated) status = 'disconnected'
          else if (h.refreshTokenValid === false) status = 'expired'
          else if (h.tokenValid === false) status = 'refreshing'
          const minutesLeft = h.expiresAt
            ? Math.round((new Date(h.expiresAt).getTime() - Date.now()) / 60000)
            : null
          return {
            status,
            account: h.userName ?? null,
            organization: h.corpName ?? null,
            accountId: h.userId ?? null,
            expiresAt: h.expiresAt ?? null,
            refreshExpiresAt: h.refreshExpiresAt ?? null,
            minutesLeft,
            selfHealing: status === 'refreshing',
            reloginCommand: status === 'expired' ? 'dws auth login' : null,
            lastCheckedAt: new Date().toISOString(),
          }
        })
        .catch((e) => ({ status: 'error', lastError: String(e?.message || e) }))
      const profile = await dws.getProfile().then((p) => ({
        current: p.currentProfile ?? null,
        count: p.profiles?.length ?? 0,
      })).catch(() => null)
      const yxConfig = readYunxiaoConfig(db)
      const yxToken = yxConfig.credentialRef
        ? await credentials.get(yxConfig.credentialRef).then((v) => !!v).catch(() => false)
        : false
      const yunxiao = {
        status: !yxConfig.configured ? 'disconnected' : yxToken ? 'connected' : 'expired',
        ...yxConfig,
        tokenStored: yxToken,
        credentialStoreSupported: credentials.supported,
      }
      return {
        dingtalk: { ...dingtalk, profile },
        yunxiao,
        capabilities: capabilityMatrix(sync, db),
      }
    },

    '/auth/dingtalk/login/status': async () => ({ job: dingtalkLogin.snapshot() }),

    '/sources/yunxiao/config': async () => {
      const cfg = readYunxiaoConfig(db)
      return { config: cfg, tokenStored: await credentials.get(cfg.credentialRef).then((v) => !!v).catch(() => false) }
    },
  }

  const POST = {
    '/sync/run': async (params, body) => {
      const source = safeEnum(body?.source ?? 'all', ['all', 'dws.todo', 'dws.report', 'dws.minutes', 'dws.chats', 'dws.attendance', 'dws.calendar', 'yunxiao.projects', 'yunxiao.repos', 'yunxiao.pipelines', 'yunxiao.workitems', 'yunxiao.commits', 'yunxiao.worklogs'])
      const results = await sync.run(source)
      // keep project links fresh after new data lands (rule layer is cheap)
      let resolve = null
      try {
        resolve = db.resolveProjectLinks()
      } catch {}
      // deterministic watchdog findings (rule insights, no LLM)
      const watchdogFindings = await sync.runWatchdog()
      return { results, resolve, watchdogFindings }
    },
    '/watchdog/run': async () => ({ findings: await sync.runWatchdog() }),
    '/chats/collect': async (params, body) => {
      const conversationId = String(body?.conversationId ?? '')
      if (!conversationId || conversationId.startsWith('-')) throw httpError(400, 'invalid conversationId')
      const sinceDays = clampInt(body?.sinceDays, 14, 1, 90)
      return { result: await sync.runChatMessages(conversationId, sinceDays) }
    },
    '/projects/create': async (params, body) => {
      const name = String(body?.name ?? '').trim()
      if (!name || name.length > 80) throw httpError(400, 'invalid name')
      const project = db.createProject({
        name,
        aliases: toStringArray(body?.aliases),
        keywords: toStringArray(body?.keywords),
        chatIds: toStringArray(body?.chatIds),
      })
      const resolve = db.resolveProjectLinks()
      return { project, resolve }
    },
    '/projects/update': async (params, body) => {
      const id = String(body?.id ?? '')
      if (!db.getProject(id)) throw httpError(404, 'project not found')
      const project = db.updateProject(id, {
        name: typeof body?.name === 'string' ? body.name.trim() : undefined,
        aliases: body?.aliases !== undefined ? toStringArray(body?.aliases) : undefined,
        keywords: body?.keywords !== undefined ? toStringArray(body?.keywords) : undefined,
        chatIds: body?.chatIds !== undefined ? toStringArray(body?.chatIds) : undefined,
      })
      return { project, resolve: db.resolveProjectLinks() }
    },
    '/projects/delete': async (params, body) => {
      const id = String(body?.id ?? '')
      if (!db.getProject(id)) throw httpError(404, 'project not found')
      db.deleteProject(id)
      return { deleted: id, resolve: db.resolveProjectLinks() }
    },
    '/projects/resolve': async () => ({ resolve: db.resolveProjectLinks() }),
    '/sources/yunxiao/save': async (params, body) => {
      const instanceType = body?.instanceType === 'center' ? 'center' : 'region'
      const baseUrl = String(body?.baseUrl ?? '').trim()
      const organizationId = String(body?.organizationId ?? '').trim() || null
      const token = String(body?.token ?? '').trim()
      if (!/^https?:\/\//.test(baseUrl)) throw httpError(400, 'invalid baseUrl')
      const credentialRef = 'yunxiao:default'
      if (token) {
        if (!credentials.supported) throw httpError(400, 'credential store unsupported on this platform')
        await credentials.set(credentialRef, token)
      }
      db.setSetting('yunxiao.instanceType', instanceType)
      db.setSetting('yunxiao.baseUrl', baseUrl)
      db.setSetting('yunxiao.organizationId', organizationId)
      db.setSetting('yunxiao.credentialRef', credentialRef)
      return { ok: true, config: readYunxiaoConfig(db) }
    },
    '/auth/dingtalk/login': async () => {
      const started = dingtalkLogin.start()
      return started
    },
    '/auth/dingtalk/login/cancel': async () => {
      dingtalkLogin.cancel()
      return { ok: true }
    },
    '/analyses/delete': async (params, body) => {
      const id = String(body?.id ?? '')
      if (!id) throw httpError(400, 'missing id')
      if (!db.getAnalysis(id)) throw httpError(404, 'analysis not found')
      db.deleteAnalysis(id)
      return { ok: true, deleted: id }
    },
    '/summaries/delete': async (params, body) => {
      const date = String(body?.date ?? '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'invalid date')
      db.deleteDailySummary(date)
      return { ok: true, deleted: date }
    },
    '/generate/daily-draft': async (params, body) => {
      const date = String(body?.date ?? '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'invalid date')
      const input = db.dayAnalysisInput(date)
      if (!input.events.length) throw httpError(409, '该日没有已采集的工作事件（先同步数据）')

      const me = await dws.getHealth().then((h) => h.userName).catch(() => null)
      const events = input.events
      const byType = input.metrics.byType ?? {}
      const commits = events.filter((e) => e.sourceType === 'commit')
      const milestones = events.filter((e) => e.sourceType === 'milestone')
      const chats = events.filter((e) => e.sourceType === 'chat_message')
      const requirements = events.filter((e) => e.sourceType === 'requirement')
      const myChats = me ? chats.filter((c) => c.actor === me) : []
      const projects = input.metrics.projects ?? []

      // ---- 代码推进：按需求号/MR 分组 ----
      const REQ_RE = /\b([A-Z]{2,6}PRO-\d+)\b/
      const codeGroups = new Map()
      let mergeCount = 0
      for (const c of commits) {
        const title = String(c.title ?? '')
        if (/^Merge\b/i.test(title)) { mergeCount += 1; continue }
        const m = REQ_RE.exec(title)
        let key
        if (m) key = m[1]
        else if (/^\d+\.\d+/.test(title)) key = '版本发布'
        else {
          const head = title.split(/[：:]/, 1)[0].trim()
          key = head.length > 2 && head.length <= 14 ? head : '其他改动'
        }
        const g = codeGroups.get(key) ?? { key, count: 0, titles: [] }
        g.count += 1
        if (g.titles.length < 3) g.titles.push(title.slice(0, 60))
        codeGroups.set(key, g)
      }
      const codeList = [...codeGroups.values()].sort((a, b) => b.count - a.count)

      // ---- 沟通要点：按会话聚合「我」的消息 ----
      const cleanText = (raw) => String(raw ?? '')
        .replace(/^\[分享\]\s*/, '')
        .replace(/\burl\s*:?\s*$/i, '')
        .replace(/\[图片消息\]\([^)]*\)/g, '[图片]')
        .replace(/\[文件消息\]\([^)]*\)/g, '[文件]')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/@[\w\u4e00-\u9fa5]+(uid:\s*\d+)?/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\s*url\s*:?\s*$/i, '')
        .replace(/[\s.。]+$/, '')
        .trim()
      const chatGroups = new Map()
      for (const c of myChats) {
        const name = c.chatName || '会话'
        const g = chatGroups.get(name) ?? { chat: name, count: 0, snippets: [], messages: [] }
        g.count += 1
        const text = cleanText(c.contentPreview ?? c.title)
        if (text && text.length >= 4) g.messages.push(text)
        chatGroups.set(name, g)
      }
      for (const g of chatGroups.values()) {
        // 取信息量最大的两条（跳过“好的/ok/1”这类短回复）
        const ranked = [...new Set(g.messages)]
          .filter((t) => t.length >= 8 && !/^(好的?|ok|OK|嗯+|收到|1|\d+)$/.test(t))
          .sort((a, b) => b.length - a.length)
        g.snippets = ranked.slice(0, 2).map((t) => t.slice(0, 70))
        delete g.messages
      }
      const commList = [...chatGroups.values()].sort((a, b) => b.count - a.count)

      // ---- 概览 ----
      const parts = []
      const workEvents = events.length - chats.length
      parts.push(`当天 ${workEvents} 条工作事件${chats.length ? ` + ${chats.length} 条聊天消息（${new Set(chats.map((c) => c.chatName)).size} 个会话）` : ''}`)
      if (byType.commit) parts.push(`代码提交 ${byType.commit} 次`)
      if (byType.requirement) parts.push(`需求变更 ${byType.requirement} 个`)
      if (milestones.length) parts.push(`处于排期节点 ${milestones.length} 个`)
      if (projects.length) parts.push(`涉及 ${projects.join('、')}`)
      if (input.metrics.checkIn) parts.push(`打卡 ${input.metrics.checkIn}–${input.metrics.checkOut ?? '未打卡下班'}`)
      if (input.metrics.worklogHours) parts.push(`报工 ${input.metrics.worklogHours}h`)

      // ---- 我今天做了什么 ----
      const myToday = []
      if (codeList.length) {
        myToday.push(`代码：${codeList.slice(0, 4).map((g) => `${g.key}（${g.count} 次提交）`).join('、')}${mergeCount ? `，另有 ${mergeCount} 次分支合并` : ''}`)
      }
      if (requirements.length) {
        myToday.push(`需求：推进 ${requirements.slice(0, 4).map((r) => r.title).join('；')}`)
      }
      if (milestones.length) {
        myToday.push(`排期：当日节点 ${milestones.slice(0, 5).map((m) => m.title).join('；')}`)
      }
      if (commList.length) {
        myToday.push(`沟通：${commList.slice(0, 5).map((c) => `${c.chat}(${c.count})`).join('、')}${commList.length > 5 ? ' 等' : ''}，我共发言 ${myChats.length} 条（当日消息 ${chats.length} 条）`)
      }
      if (byType.report) myToday.push(`记录：提交 ${byType.report} 篇日志/日报`)

      const achievements = []
      for (const g of codeList.slice(0, 3)) {
        achievements.push(`代码 · ${g.key}：${g.count} 次提交 —— ${g.titles.slice(0, 2).map((t) => t.replace(/[；;]\s*$/, '')).join(' · ')}`)
      }
      if (mergeCount) achievements.push(`分支合并 ${mergeCount} 次（release / master 合流）`)
      for (const c of commList.slice(0, 4)) {
        achievements.push(`沟通 · ${c.chat}：发言 ${c.count} 条${c.snippets[0] ? ` —— 「${c.snippets[0]}」` : ''}`)
      }
      if (requirements.length) achievements.push(`需求 · ${requirements.slice(0, 3).map((r) => r.title).join('；')}`)
      for (const m of (input.meetings ?? []).filter((x) => x.summary).slice(0, 3)) {
        achievements.push(`会议 · ${m.title}：${m.summary.slice(0, 120)}`)
      }
      if (!achievements.length) achievements.push(`完成 ${events.length} 条工作事件`)

      const summary = db.saveDailySummary({
        date,
        overview: parts.join('，') + '。' + (myToday.length ? `\n\n我今天做了什么：${myToday.join('；')}。` : ''),
        achievements,
        decisions: [],
        blockers: [],
        nextActions: milestones.length
          ? [`排期节点：${milestones.slice(0, 5).map((m) => m.title).join('；')}`]
          : [],
        metrics: {
          ...input.metrics,
          generatedBy: 'rule',
          me: me ?? null,
          codeGroups: codeList.slice(0, 6),
          merges: mergeCount,
          communications: commList.slice(0, 8),
          myToday,
          milestoneTitles: milestones.map((m) => m.title).slice(0, 10),
        },
        sources: input.sources.slice(0, 60),
      })
      return { ok: true, summary, generatedBy: 'rule' }
    },
    '/generate/chat-summary': async (params, body) => {
      const chatId = String(body?.chatId ?? '')
      if (!chatId) throw httpError(400, 'missing chatId')
      const days = clampInt(body?.days, 14, 1, 90)
      const input = db.chatAnalysisInput(chatId, days)
      if (!input.stats.total) throw httpError(409, '该会话没有已采集的消息（先在数据管理采集）')

      const clean = (raw) => String(raw ?? '')
        .replace(/^\[分享\]\s*/, '')
        .replace(/\[图片消息\]\([^)]*\)/g, '[图片]')
        .replace(/\[文件消息\]\([^)]*\)/g, '[文件]')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/@[\w\u4e00-\u9fa5]+(uid:\s*\d+)?/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      const msgs = input.messages
        .map((m) => ({ sender: m.sender, text: clean(m.text), day: m.day }))
        .filter((m) => m.text && m.text.length >= 2)

      const REQ_RE = /\b([A-Z]{2,6}PRO-\d+)\b/
      const TOPIC_RULES = [
        ['需求与排期', /(需求|排期|提测|上线|发版|灰度|发布|验收|评审|系分)/],
        ['问题与故障', /(报错|异常|故障|失败|bug|问题|修复|排查|回滚)/],
        ['测试与质量', /(测试|用例|回归|验证|自测)/],
        ['发布与配置', /(配置|开关|参数|环境|部署|脚本)/],
        ['数据与指标', /(数据|指标|埋点|统计|看板|报表)/],
        ['协作与流程', /(会议|同步|对齐|确认|安排|分工|排期)/],
      ]
      const buckets = new Map()
      const addTo = (name, m) => {
        const b = buckets.get(name) ?? { name, count: 0, samples: [] }
        b.count += 1
        if (b.samples.length < 2 && m.text.length >= 8) b.samples.push(`${m.sender}：${m.text.slice(0, 60)}`)
        buckets.set(name, b)
      }
      for (const m of msgs) {
        const req = REQ_RE.exec(m.text)
        if (req) addTo(req[1], m)
        for (const [name, re] of TOPIC_RULES) {
          if (re.test(m.text)) addTo(name, m)
          if (buckets.size > 12) break
        }
      }
      const topics = [...buckets.values()].sort((a, b) => b.count - a.count).slice(0, 6)

      const ACTION_RE = /(需要|请帮忙|帮忙|跟进|确认一下|安排|处理一下|改一下|补充|同步一下|尽快|今天|明天|本周)/
      const QUESTION_RE = /[?？]|(怎么|为什么|是不是|能否|是否|有没有)/
      const actionItems = msgs
        .filter((m) => m.text.length >= 8 && ACTION_RE.test(m.text) && !QUESTION_RE.test(m.text))
        .slice(-8)
        .reverse()
        .slice(0, 5)
        .map((m) => ({ sender: m.sender, text: m.text.slice(0, 80) }))
      const questions = msgs
        .filter((m) => QUESTION_RE.test(m.text) && m.text.length >= 6)
        .slice(-8)
        .reverse()
        .slice(0, 5)
        .map((m) => ({ sender: m.sender, text: m.text.slice(0, 80) }))

      const bySender = input.stats.bySender
      const topSenders = Object.entries(bySender).sort((a, b) => b[1] - a[1]).slice(0, 5)
      const byDay = input.stats.byDay
      const activeDays = Object.keys(byDay).length
      const overview = `${input.chat.name || '该会话'}近 ${days} 天共 ${input.stats.total} 条消息，${input.stats.participants} 人参与、活跃 ${activeDays} 天；`
        + `主要发言：${topSenders.map(([n, c]) => `${n}(${c})`).join('、')}；`
        + `${topics.length ? `讨论集中在 ${topics.slice(0, 3).map((t) => t.name).join('、')}` : '讨论较分散'}；`
        + `${actionItems.length ? `提取到 ${actionItems.length} 条行动项` : '未识别到明确行动项'}，${questions.length} 个未决问题。`

      const analysis = db.saveAnalysis({
        kind: 'chat_summary',
        scope: { chatId, days, chatName: input.chat.name ?? null },
        payload: { overview, topics, actionItems, questions, topSenders, activeDays, generatedBy: 'rule' },
        sources: input.sources.slice(0, 60),
        model: 'rule-engine',
      })
      return { ok: true, analysis, generatedBy: 'rule' }
    },
    '/generate/report-draft': async (params, body) => {
      const hasCustom = !!(body?.start && body?.end)
      const range = resolveRange({
        preset: hasCustom ? undefined : (body?.preset ?? 'company_period'),
        start: body?.start ?? undefined,
        end: body?.end ?? undefined,
      })
      const { startDate, endDate } = range
      const me = await dws.getHealth().then((h) => h.userName).catch(() => null)
      const statusMap = db.requirementStatusMap()

      const rangeRows = (type) => {
        const sql = type
          ? "SELECT id, source_type, source_id, title, content, actor, occurred_at, local_date, chat_id, raw_json FROM work_items WHERE local_date >= ? AND local_date <= ? AND source_type = ?"
          : 'SELECT id, source_type, source_id, title, content, actor, occurred_at, local_date, chat_id, raw_json FROM work_items WHERE local_date >= ? AND local_date <= ?'
        return (type
          ? db.db.prepare(sql).all(startDate, endDate, type)
          : db.db.prepare(sql).all(startDate, endDate)) || []
      }
      const all = rangeRows()
      const commits = rangeRows('commit')
      const milestones = rangeRows('milestone').filter((m) => {
        const serial = String(m.title ?? '').split(' ')[0]
        return !db.isRetiredRequirement(serial, m.local_date, statusMap, db.weekStartIso())
      })
      const chats = rangeRows('chat_message')
      const reports = rangeRows('report')
      const minutes = rangeRows('minutes')
      const worklogs = rangeRows('worklog')
      const attendance = rangeRows('attendance')
      const requirements = rangeRows('requirement')
      const todos = rangeRows('todo')

      const chatsByMe = me ? chats.filter((c) => c.actor === me) : []

      // ---- 代码：按需求号分组 ----
      const REQ_RE = /\b([A-Z]{2,6}PRO-\d+)\b/
      const codeGroups = new Map()
      let merges = 0
      const stripPrefix = (t) => String(t ?? '')
        .replace(/^(feat|fix|docs|chore|refactor|test|style|perf|build|ci|revert)(\([^)]*\))?\s*[:：]\s*/i, '')
        .trim()
      for (const c of commits) {
        const raw = String(c.title ?? '')
        if (/^Merge\b/i.test(raw)) { merges += 1; continue }
        const title = stripPrefix(raw)
        const m = REQ_RE.exec(title)
        const key = m ? m[1] : (() => {
          // 没有需求号时按仓库聚合（commit.content 存的是仓库名）
          const repo = String(c.content ?? '').replace(/^代码仓库\s*·\s*/, '').trim()
          if (repo) return repo
          if (/^\d+\.\d+/.test(title)) return '版本发布'
          const head = title.split(/[：:]/, 1)[0].trim()
          return head.length > 2 && head.length <= 14 ? head : '其他改动'
        })()
        const g = codeGroups.get(key) ?? { key, count: 0, titles: [] }
        g.count += 1
        if (g.titles.length < 3) g.titles.push(title.slice(0, 70))
        codeGroups.set(key, g)
      }
      const codeList = [...codeGroups.values()].sort((a, b) => b.count - a.count)

      // ---- 逐日概览 ----
      const dayMap = new Map()
      for (const r of all) {
        const d = dayMap.get(r.local_date) ?? { date: r.local_date, events: 0, commits: 0, chats: 0, mine: 0, milestones: 0, requirements: 0 }
        if (r.source_type !== 'chat_message') d.events += 1
        if (r.source_type === 'commit') d.commits += 1
        if (r.source_type === 'chat_message') { d.chats += 1; if (me && r.actor === me) d.mine += 1 }
        if (r.source_type === 'milestone') d.milestones += 1
        if (r.source_type === 'requirement') d.requirements += 1
        dayMap.set(r.local_date, d)
      }
      const todayIso = new Date().toISOString().slice(0, 10)
      const dayLines = [...dayMap.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .filter((d) => d.events || d.chats)
        .filter((d) => d.date <= todayIso)
        .map((d) => `${d.date.slice(5)}：${d.events} 事件 / ${d.commits} 提交 / 我发言 ${d.mine} 条${d.milestones ? ` / 排期 ${d.milestones}` : ''}`)

      // ---- 项目投入 ----
      const projects = {}
      for (const r of db.projectActivityRange(startDate, endDate)) {
        projects[r.name] = (projects[r.name] ?? 0) + r.n
      }
      const topProjects = Object.entries(projects).sort((a, b) => b[1] - a[1]).slice(0, 8)

      // ---- 沟通：我发言的会话 ----
      const cleanText = (raw) => String(raw ?? '')
        .replace(/^\[分享\]\s*/, '')
        .replace(/\[图片消息\]\([^)]*\)/g, '[图片]')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/@[\w\u4e00-\u9fa5]+(uid:\s*\d+)?/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\s*url\s*:?\s*$/i, '')
        .trim()
      const chatNameOf = new Map(
        (db.db.prepare('SELECT conversation_id, name FROM chats').all() || []).map((c) => [c.conversation_id, c.name]),
      )
      const commMap = new Map()
      for (const c of chatsByMe) {
        const name = chatNameOf.get(c.chat_id) ?? '会话'
        const g = commMap.get(name) ?? { chat: name, count: 0, msgs: [] }
        g.count += 1
        const text = cleanText(c.content ?? c.title)
        if (text.length >= 8) g.msgs.push(text)
        commMap.set(name, g)
      }
      const NOISE = /^(日程：|会议邀请|入会：|\[图片\]$)/
      const commList = [...commMap.values()].sort((a, b) => b.count - a.count).slice(0, 6).map((g) => {
        const best = [...new Set(g.msgs)]
          .filter((t) => !NOISE.test(t))
          .sort((a, b) => b.length - a.length)[0]
        return { chat: g.chat, count: g.count, snippet: best ? best.slice(0, 80) : null }
      })

      // ---- 排期节点（本周 / 下周）----
      const fmtMs = (m) => `${m.local_date.slice(5)} ${String(m.title ?? '')}`
      const milestoneLines = milestones
        .slice()
        .sort((a, b) => a.local_date.localeCompare(b.local_date))
        .map(fmtMs)
      const nextStart = new Date(new Date(startDate).getTime() + 7 * 86_400_000)
      const nextEnd = new Date(nextStart.getTime() + 6 * 86_400_000)
      const nextStartIso = nextStart.toISOString().slice(0, 10)
      const nextEndIso = nextEnd.toISOString().slice(0, 10)
      const nextMilestones = (db.db
        .prepare("SELECT local_date, title FROM work_items WHERE source_type='milestone' AND local_date >= ? AND local_date <= ? ORDER BY local_date")
        .all(nextStartIso, nextEndIso) || [])

      // ---- 风险 ----
      const today = new Date().toISOString().slice(0, 10)
      const overdue = (db.db
        .prepare("SELECT local_date, title, raw_json FROM work_items WHERE source_type='milestone' AND local_date < ? ORDER BY local_date DESC LIMIT 200")
        .all(today) || [])
        .filter((m) => {
          let raw = {}
          try { raw = JSON.parse(m.raw_json || '{}') } catch {}
          if (raw.field !== '计划完成时间') return false
          return !/(完成|上线|已发布|关闭|取消)/.test(statusMap.get(raw.serial) ?? '')
        })
        .map((m) => m.title)
      const riskLines = []
      if (overdue.length) riskLines.push(`已过计划完成时间但未完成：${[...new Set(overdue)].slice(0, 6).join('；')}`)
      const projActivity = {}
      for (const r of db.projectActivityRange(startDate, endDate)) {
        projActivity[r.name] = projActivity[r.name] ?? { chats: 0, todos: 0 }
        if (r.source_type === 'chat_message') projActivity[r.name].chats += r.n
        if (r.source_type === 'todo') projActivity[r.name].todos += r.n
      }
      for (const [name, v] of Object.entries(projActivity)) {
        if (v.chats >= 10 && v.todos === 0) riskLines.push(`${name}：本周 ${v.chats} 条讨论但无关联待办，需确认是否形成任务`)
      }

      // ---- 组装 sections ----
      const total = all.length
      const sections = []
      sections.push({
        title: '工作概况',
        content: [
          `周期：${startDate} ~ ${endDate}（${range.days} 天）`,
          `工作事件 ${total - chats.length} 条 + 聊天消息 ${chats.length} 条；代码提交 ${commits.length} 次（含 ${merges} 次分支合并）；`
            + `需求变更 ${requirements.length} 个；排期节点 ${milestones.length} 个；日报/纪要 ${reports.length + minutes.length} 篇；报工 ${worklogs.length} 条`,
          attendance.length ? `打卡记录 ${attendance.length} 条` : null,
          topProjects.length ? `项目投入：${topProjects.map(([n, c]) => `${n}(${c})`).join('、')}` : '暂无项目关联数据',
        ].filter(Boolean).join('\n'),
      })
      if (dayLines.length) sections.push({ title: '逐日概览', content: dayLines.join('\n') })
      if (codeList.length) {
        sections.push({
          title: '代码推进',
          content: codeList.slice(0, 8).map((g) =>
            `· ${g.key}：${g.count} 次提交 —— ${g.titles.join(' / ')}`).join('\n')
            + (merges ? `\n· 分支合并 ${merges} 次（release / master 合流）` : ''),
        })
      }
      if (milestoneLines.length) sections.push({ title: '本周排期节点', content: milestoneLines.slice(0, 20).join('\n') })
      const meetingRows = db.db
        .prepare("SELECT title, content, raw_json, local_date FROM work_items WHERE source_type IN ('minutes','calendar_event') AND local_date >= ? AND local_date <= ? ORDER BY local_date")
        .all(startDate, endDate) || []
      const meetingRowsFiltered = meetingRows.filter((m) => {
        let raw = {}
        try { raw = JSON.parse(m.raw_json || '{}') } catch {}
        if (raw.summary) return true
        const isGeneric = /预定的会议|视频会议|会议$/.test(String(m.title ?? ''))
        const dayHasMinutes = meetingRows.some((x) => x.local_date === m.local_date && (() => {
          try { return !!JSON.parse(x.raw_json || '{}').summary } catch { return false }
        })())
        return !(isGeneric && dayHasMinutes)
      })
      if (meetingRowsFiltered.length) {
        const lines = meetingRowsFiltered.slice(0, 12).map((m) => {
          let raw = {}
          try { raw = JSON.parse(m.raw_json || '{}') } catch {}
          const dur = raw.durationMinutes ? ` (${raw.durationMinutes} 分钟)` : ''
          const sum = raw.summary
            ? ` —— ${String(raw.summary).replace(/[#*>\-|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)}`
            : ''
          return `· ${m.local_date.slice(5)} ${m.title}${dur}${sum}`
        })
        sections.push({ title: `会议与决策 · ${meetingRowsFiltered.length}`, content: lines.join('\n') })
      }
      if (commList.length) {
        sections.push({
          title: '沟通与协作',
          content: commList.map((c) => `· ${c.chat}：我发言 ${c.count} 条${c.snippet ? ` —— 「${c.snippet}」` : ''}`).join('\n'),
        })
      }
      sections.push({
        title: '产出与记录',
        content: [
          reports.length ? `· 日报/日志 ${reports.length} 篇` : null,
          minutes.length ? `· 会议纪要 ${minutes.length} 篇` : null,
          worklogs.length ? `· 报工 ${worklogs.length} 条` : null,
          attendance.length ? `· 打卡 ${attendance.length} 次` : null,
          todos.length ? `· 待办同步 ${todos.length} 条（含历史项，需人工核对）` : null,
        ].filter(Boolean).join('\n') || '本周期无产出类记录',
      })
      if (riskLines.length) sections.push({ title: '风险与待跟进', content: riskLines.map((x) => `· ${x}`).join('\n') })
      sections.push({
        title: '下周计划（排期节点预告）',
        content: nextMilestones.length
          ? nextMilestones.slice(0, 15).map((m) => `· ${m.local_date.slice(5)} ${m.title}`).join('\n')
          : '下周期暂无已录入的排期节点',
      })

      const overview = `本周报周期（${startDate} ~ ${endDate}）共 ${total - chats.length} 条工作事件 + ${chats.length} 条聊天消息；`
        + `代码提交 ${commits.length} 次，${topProjects.length ? `主要投入 ${topProjects[0][0]}` : '暂无项目关联'}；`
        + `${milestones.length ? `排期节点 ${milestones.length} 个` : '无排期节点变更'}${riskLines.length ? `，有 ${riskLines.length} 项待跟进` : ''}。`

      const analysis = db.saveAnalysis({
        kind: 'report_draft',
        scope: { periodDays: range.days, startDate, endDate },
        payload: { title: `工作周报草稿（${startDate} ~ ${endDate}）`, overview, sections, generatedBy: 'rule' },
        sources: [...commits.slice(0, 20), ...milestones.slice(0, 10), ...requirements.slice(0, 10), ...reports.slice(0, 5)]
          .map((w) => ({ sourceType: w.source_type, sourceId: w.source_id, itemId: w.id, title: w.title, timestamp: w.occurred_at })),
        model: 'rule-engine',
      })
      return { ok: true, analysis, generatedBy: 'rule' }
    },
    '/actions/pipelines/run': async (params, body) => {
      const pipelineId = String(body?.pipelineId ?? '')
      if (!/^\d+$/.test(pipelineId)) throw httpError(400, 'invalid pipelineId')
      const { YunxiaoClient } = await import('./yunxiao/client.js')
      const yx = new YunxiaoClient({ db, credentials })
      try {
        const runId = await yx.runPipeline(pipelineId)
        db.logAction({ operator: 'ui', action: 'pipeline.run', target: pipelineId, status: 'ok', result: { runId } })
        return { ok: true, runId }
      } catch (e) {
        db.logAction({ operator: 'ui', action: 'pipeline.run', target: pipelineId, status: 'error', result: { error: String(e?.message || e) } })
        throw e
      }
    },
    /* 应用交付：创建部署单（Deploy 最新编排版本到指定环境）。真实写操作，必须 userConfirmed。 */
    '/actions/appstack/deploy': async (params, body) => {
      const appName = String(body?.appName ?? '')
      const envName = String(body?.envName ?? '')
      if (!/^[\w.-]+$/.test(appName) || !/^[\w.-]+$/.test(envName)) throw httpError(400, 'invalid appName/envName')
      if (body?.userConfirmed !== true) throw httpError(400, '部署需要用户确认（userConfirmed: true）')
      const { YunxiaoClient } = await import('./yunxiao/client.js')
      const yx = new YunxiaoClient({ db, credentials })
      try {
        const orch = await yx.getLatestOrchestration(appName)
        if (!orch?.sha) throw new Error('未找到应用编排版本（KUBERNETES）')
        const changeOrderName = `${new Date().toISOString().replace(/[-:TZ]/g, '').slice(0, 14)}-部署-workhub`
        const order = await yx.createChangeOrder(appName, {
          changeOrderName,
          type: 'Deploy',
          description: 'WorkHub 快捷执行触发',
          envs: { [envName]: { values: {} } },
          orchestrationRevisionSha: orch.sha,
        })
        db.logAction({
          operator: 'ui', action: 'appstack.deploy', target: `${appName}/${envName}`, status: 'ok',
          result: { changeOrderName: order?.name ?? changeOrderName, sn: order?.sn ?? '', state: order?.state ?? '', sha: orch.sha },
        })
        return { ok: true, order: { name: order?.name ?? changeOrderName, state: order?.state ?? '', sn: order?.sn ?? '' }, sha: orch.sha }
      } catch (e) {
        db.logAction({ operator: 'ui', action: 'appstack.deploy', target: `${appName}/${envName}`, status: 'error', result: { error: String(e?.message || e) } })
        throw e
      }
    },
    /* 应用交付本地偏好写入：favorites 全量替换（≤30 个），notes 按 key 合并（空值删除）。 */
    '/actions/appstack/prefs': async (params, body) => {
      let prefs = {}
      try { prefs = JSON.parse(db.getSetting('appstack.prefs') ?? '{}') } catch { prefs = {} }
      if (Array.isArray(body?.favorites)) {
        prefs.favorites = [...new Set(body.favorites.map(String).filter((x) => /^[\w.-]+$/.test(x)))].slice(0, 30)
      }
      if (body?.notes && typeof body.notes === 'object' && !Array.isArray(body.notes)) {
        const notes = { ...(prefs.notes ?? {}) }
        for (const [k, v] of Object.entries(body.notes)) {
          if (!/^[\w.-]+$/.test(k)) continue
          if (v == null || String(v).trim() === '') delete notes[k]
          else notes[k] = String(v).slice(0, 200)
        }
        prefs.notes = notes
      }
      db.setSetting('appstack.prefs', JSON.stringify(prefs))
      return { ok: true, favorites: prefs.favorites ?? [], notes: prefs.notes ?? {} }
    },
    '/sources/yunxiao/disconnect': async () => {
      const ref = db.getSetting('yunxiao.credentialRef')
      if (ref) await credentials.delete(ref)
      db.setSetting('yunxiao.credentialRef', null)
      return { ok: true }
    },
  }

  return {
    prefix,
    db,
    sync,
    dws,
    credentials,
    dingtalkLogin,
    dispose: () => dingtalkLogin.dispose(),
    handler: async (req, res) => {
      let url
      try {
        url = new URL(req.url, 'http://localhost')
      } catch {
        return sendJson(res, 400, { ok: false, error: { code: 'bad-request' } })
      }
      const rel = (url.pathname.slice(prefix.length) || '/').replace(/\/+$/, '') || '/'
      try {
        if (req.method === 'GET' || req.method === 'HEAD') {
          const handler = GET[rel]
          if (!handler) return sendJson(res, 404, { ok: false, error: { code: 'not-found', message: rel } })
          const body = await handler(url.searchParams, req, res)
          if (body === null) return // handler already sent the response
          return sendJson(res, 200, { ok: true, ...body })
        }
        if (req.method === 'POST') {
          const handler = POST[rel]
          if (!handler) return sendJson(res, 404, { ok: false, error: { code: 'not-found', message: rel } })
          const body = await readJsonBody(req)
          return sendJson(res, 200, { ok: true, ...(await handler(url.searchParams, body)) })
        }
        return sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed' } })
      } catch (error) {
        return sendJson(res, error?.status ?? 502, {
          ok: false,
          error: { code: error?.code ?? 'upstream-error', message: String(error?.message || error) },
        })
      }
    },
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => {
      chunks.push(c)
      if (chunks.reduce((n, b) => n + b.length, 0) > 1_000_000) reject(httpError(413, 'body too large'))
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(httpError(400, 'invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function safeEnum(value, allowed) {
  return allowed.includes(value) ? value : undefined
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).slice(0, 50)
  if (typeof value === 'string') {
    return value.split(/[,，\n]/).map((v) => v.trim()).filter(Boolean).slice(0, 50)
  }
  return []
}

function httpError(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}
