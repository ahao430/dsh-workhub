/**
 * Screenshot generator for README.
 *
 * Renders the REAL client.js component tree (no DOM) with a stub React +
 * fake API data into standalone HTML files, then the caller uses headless
 * Chrome to turn them into PNGs. All data below is synthetic.
 *
 *   node tests/screenshot.mjs            # writes docs/screens/*.html
 *   # then: Google Chrome --headless --screenshot=...
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, '..', 'docs', 'screens')
fs.mkdirSync(outDir, { recursive: true })

/* ------------------------------------------------------------------ */
/* fake dataset (fully synthetic)                                      */
/* ------------------------------------------------------------------ */

const WEEK = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']

const MOCK = {
  '/api/workhub/time/resolve': {
    range: { preset: 'this_week', startDate: '2026-11-02', endDate: '2026-11-04', days: 3, granularity: 'day', compare: false, prevStartDate: '2026-10-30', prevEndDate: '2026-11-01' },
  },
  '/api/workhub/analytics/dashboard': {
    range: { preset: 'this_week', startDate: '2026-11-02', endDate: '2026-11-04', days: 3, granularity: 'day', compare: true, prevStartDate: '2026-10-30', prevEndDate: '2026-11-01' },
    counts: { attendance: 6, chat_message: 208, commit: 42, milestone: 31, report: 4, requirement: 9 },
    activity: [
      { bucket: '2026-11-02', source_type: 'commit', n: 22 },
      { bucket: '2026-11-02', source_type: 'requirement', n: 5 },
      { bucket: '2026-11-02', source_type: 'chat_message', n: 96 },
      { bucket: '2026-11-03', source_type: 'commit', n: 15 },
      { bucket: '2026-11-03', source_type: 'requirement', n: 3 },
      { bucket: '2026-11-03', source_type: 'chat_message', n: 84 },
      { bucket: '2026-11-03', source_type: 'attendance', n: 2 },
      { bucket: '2026-11-04', source_type: 'commit', n: 5 },
      { bucket: '2026-11-04', source_type: 'chat_message', n: 28 },
      { bucket: '2026-11-04', source_type: 'attendance', n: 2 },
    ],
    bucketRequirements: {
      '2026-11-02': [{ serial: 'DEMO-101', count: 8 }, { serial: 'DEMO-102', count: 3 }],
      '2026-11-03': [{ serial: 'DEMO-103', count: 6 }, { serial: 'DEMO-101', count: 2 }],
      '2026-11-04': [{ serial: 'DEMO-104', count: 2 }],
    },
    projectActivity: [
      { id: 'p1', name: '示例项目 A', source_type: 'commit', n: 24 },
      { id: 'p1', name: '示例项目 A', source_type: 'requirement', n: 4 },
      { id: 'p2', name: '示例项目 B', source_type: 'commit', n: 12 },
      { id: 'p2', name: '示例项目 B', source_type: 'chat_message', n: 8 },
      { id: 'p3', name: '示例项目 C', source_type: 'requirement', n: 5 },
    ],
    activeProjects: 3,
    inProgress: [
      { source_id: 'DEMO-107', title: 'DEMO-107 示例网关超时参数调优', status: '架构系分+开发中', day: '2026-11-04' },
      { source_id: 'DEMO-105', title: 'DEMO-105 审计日志接入需求', status: '待处理', day: '2026-11-03' },
      { source_id: 'DEMO-106', title: 'DEMO-106 会员权益行权限制', status: '测试中', day: '2026-11-03' },
    ],
    compare: {
      range: { startDate: '2026-10-30', endDate: '2026-11-01' },
      counts: { attendance: 4, chat_message: 150, commit: 30, milestone: 18, report: 3, requirement: 6 },
      activeProjects: 2,
    },
  },
  '/api/workhub/analytics/inprogress/grouped?': {
    range: { startDate: '2026-10-06', endDate: '2026-11-04' },
    groups: [
      { projectId: 'p1', name: '示例项目 A', total: 5, items: [
        { source_id: 'DEMO-107', title: 'DEMO-107 示例网关超时参数调优', status: '架构系分+开发中', day: '2026-11-04' },
        { source_id: 'DEMO-105', title: 'DEMO-105 审计日志接入需求', status: '待处理', day: '2026-11-03' },
        { source_id: 'DEMO-106', title: 'DEMO-106 会员权益行权限制', status: '测试中', day: '2026-11-02' }] },
      { projectId: 'p2', name: '示例项目 B', total: 2, items: [
        { source_id: 'DEMO-108', title: 'DEMO-108 建站模板升级', status: '待完成', day: '2026-11-01' }] },
    ],
  },
  '/api/workhub/analyses?kind=insight': {
    analyses: [
      { id: 'i1', kind: 'insight', scope: { projectId: 'p1' }, payload: { title: '示例项目 A 近两周讨论集中在接口兼容性', description: '规则引擎检测到 24 条消息涉及协议适配，且其中 6 条尚未形成待办；建议在下次评审确认拆分。', importance: 'high', origin: 'ai' }, sources: [{ sourceType: 'chat_message' }, { sourceType: 'requirement' }], generatedAt: '2026-11-04T09:12:00Z' },
      { id: 'i2', kind: 'insight', scope: {}, payload: { title: '示例项目 C 已 16 天无关联工作记录', description: '该项目近 90 天有 12 条记录，最近一次为 2026-10-19，可能已收尾或停滞。', importance: 'medium', origin: 'rule' }, sources: [{ sourceType: 'requirement' }], generatedAt: '2026-11-04T09:12:00Z' },
    ],
  },
  '/api/workhub/analyses?kind=report_draft': {
    analyses: [{
      id: 'r1', kind: 'report_draft',
      scope: { startDate: '2026-10-30', endDate: '2026-11-04' },
      payload: {
        title: '工作周报草稿（2026-10-30 ~ 2026-11-04）',
        overview: '本周报周期共 246 条工作事件 + 620 条聊天消息；代码提交 88 次，主要投入 示例项目 A；排期节点 31 个，有 1 项待跟进。',
        sections: [
          { title: '工作概况', content: '周期：2026-10-30 ~ 2026-11-04（6 天）\n工作事件 246 条 + 聊天消息 620 条；代码提交 88 次（含 14 次分支合并）；需求变更 9 个\n项目投入：示例项目 A(28)、示例项目 B(20)、示例项目 C(5)' },
          { title: '逐日概览', content: '10-30：52 事件 / 30 提交 / 我发言 24 条 / 排期 12\n11-02：64 事件 / 22 提交 / 我发言 96 条 / 排期 9\n11-03：58 事件 / 15 提交 / 我发言 84 条 / 排期 7' },
          { title: '代码推进', content: '· 示例项目 A：24 次提交 —— DEMO-101 接口适配 / 缓存层重构 / 灰度开关接入\n· 示例项目 B：12 次提交 —— DEMO-102 页面改版、埋点补齐\n· 分支合并 14 次（release / master 合流）' },
        ],
        generatedBy: 'rule',
      },
      sources: new Array(42).fill(0).map(() => ({ sourceType: 'commit' })),
      generatedAt: '2026-11-04T09:30:00Z',
    }],
  },
  '/api/workhub/analyses?kind=chat_summary': {
    analyses: [{
      id: 'c1', kind: 'chat_summary', scope: { chatId: 'cid_demo_1', chatName: '示例技术群', days: 14 },
      payload: {
        overview: '示例技术群近 14 天共 186 条消息，7 人参与、活跃 8 天；主要发言：张三(48)、李四(36)、王五(21)；讨论集中在 需求与排期、问题与故障；提取到 4 条行动项，3 个未决问题。',
        topics: [
          { name: '需求与排期', count: 42, samples: ['张三：DEMO-101 计划本周五提测，周五上午冒烟', '李四：排期我同步给测试同学，明天给结论'] },
          { name: '问题与故障', count: 26, samples: ['王五：线上灰度实例偶发 502，怀疑是新网关超时配置'] },
          { name: '数据与指标', count: 12, samples: ['张三：埋点补齐后看板数据昨天开始正常'] },
        ],
        actionItems: [
          { sender: '张三', text: '今天下班前把 DEMO-101 的接口文档补齐并发群里' },
          { sender: '李四', text: '明天上午 10 点约一次联调，确认网关超时参数' },
          { sender: '王五', text: '本周内把灰度实例的监控告警接上' },
        ],
        questions: [
          { sender: '李四', text: '新网关的超时是不是要先跟运维确认？' },
          { sender: '王五', text: 'DEMO-102 的排期要不要顺延一天？' },
        ],
        topSenders: [['张三', 48], ['李四', 36], ['王五', 21]],
        activeDays: 8, generatedBy: 'rule',
      },
      sources: new Array(60).fill(0).map(() => ({ sourceType: 'chat_message' })),
      generatedAt: '2026-11-04T09:40:00Z',
    }],
  },
  '/api/workhub/calendar?': {
    days: [
      { date: '2026-10-30', events: 42, meetings: 2, todos: 6, chats: 0, reports: 1, commits: 30, requirements: 3, tasks: 0, attendance: 2, checkIn: '09:12', checkOut: '20:41', attendanceComplete: true, worklogHours: 9.5, worklogEntries: 1, topRequirement: { serial: 'DEMO-101', count: 7 }, milestoneCount: 5, milestones: [], projects: { '示例项目 A': 12 }, hasSummary: true },
      { date: '2026-11-02', events: 64, meetings: 1, todos: 4, chats: 96, reports: 1, commits: 22, requirements: 5, tasks: 1, attendance: 0, worklogHours: 9, worklogEntries: 1, topRequirement: { serial: 'DEMO-101', count: 8 }, milestoneCount: 9, milestones: [], projects: { '示例项目 A': 18 }, hasSummary: true },
      { date: '2026-11-03', events: 58, meetings: 1, todos: 3, chats: 84, reports: 1, commits: 15, requirements: 3, tasks: 0, attendance: 2, checkIn: '09:43', checkOut: '21:17', attendanceComplete: true, worklogHours: 10.6, worklogEntries: 1, topRequirement: { serial: 'DEMO-103', count: 6 }, milestoneCount: 7, milestones: [], projects: { '示例项目 A': 9 }, hasSummary: false },
      { date: '2026-11-04', events: 28, meetings: 0, todos: 2, chats: 28, reports: 0, commits: 5, requirements: 1, tasks: 0, attendance: 2, checkIn: '08:58', checkOut: '18:30', attendanceComplete: true, worklogHours: 8.5, worklogEntries: 1, topRequirement: { serial: 'DEMO-104', count: 2 }, milestoneCount: 2, milestones: [], projects: { '示例项目 B': 4 }, hasSummary: false },
    ],
  },
  '/api/workhub/calendar/day?': {
    events: [
      { id: 'e1', time: '08:58', sourceType: 'attendance', title: '上班 · 示例园区 A 座', actor: '示例用户', projects: [] },
      { id: 'e2', time: '09:20', sourceType: 'chat_message', title: '张三：DEMO-101 的接口文档我下午补齐', actor: '张三', chatId: 'cid_demo_1', chatName: '示例技术群', projects: ['示例项目 A'] },
      { id: 'e3', time: '10:05', sourceType: 'commit', title: 'DEMO-101 接口适配：兼容旧版返回结构', actor: '示例用户', projects: ['示例项目 A'] },
      { id: 'e4', time: '11:00', sourceType: 'minutes', title: '11-04 示例项目 A 评审', actor: '示例用户', projects: ['示例项目 A'] },
      { id: 'e5', time: '14:30', sourceType: 'requirement', title: 'DEMO-104 示例需求：埋点补齐', actor: '李四', projects: ['示例项目 B'] },
      { id: 'e6', time: '18:30', sourceType: 'attendance', title: '下班 · 示例园区 A 座', actor: '示例用户', projects: [] },
    ],
    milestones: ['DEMO-104 计划提测', 'DEMO-101 计划完成'],
    meetings: [
      {
        title: '11-04 示例项目 A 评审',
        summary: '技术评审 · 示例项目 A 接口兼容方案（议题数 3 · 听记时长 46 分钟） 1. 协议适配范围 2. 灰度策略 3. 回滚预案',
        actions: ['补齐 DEMO-101 接口文档并沉淀到示例知识库', '周三前完成新网关超时参数确认', '上线前补充回滚脚本与演练记录'],
        keywords: ['接口兼容', '灰度策略', '回滚预案'],
        durationMinutes: 46,
      },
    ],
    metrics: { total: 6, byType: { attendance: 2, chat_message: 1, commit: 1, minutes: 1, requirement: 1 }, projects: ['示例项目 A', '示例项目 B'], checkIn: '08:58', checkOut: '18:30', worklogHours: 8.5, worklogEntries: 1 },
    summary: {
      status: 'ready',
      overview: '上午完成 DEMO-101 接口兼容改造并进入自测；与示例技术群确认灰度范围；下午推进 DEMO-104 埋点补齐。',
      achievements: ['DEMO-101 接口适配完成，兼容旧版返回结构', '示例技术群确认灰度放量节奏（5% → 20%）'],
      decisions: ['灰度按 5% → 20% 两阶段放量，观察 24 小时'],
      blockers: ['新网关超时参数待运维确认'],
      nextActions: ['补齐接口文档', '补充回滚脚本'],
      metrics: { checkIn: '08:58', checkOut: '18:30', worklogHours: 8.5 },
      sources: new Array(18).fill(0).map(() => ({ sourceType: 'commit' })),
      generatedAt: '2026-11-04T10:00:00Z',
    },
    inProgress: [
      { source_id: 'DEMO-107', title: 'DEMO-107 示例网关超时参数调优', status: '架构系分+开发中', day: '2026-11-04' },
      { source_id: 'DEMO-105', title: 'DEMO-105 审计日志接入需求', status: '待处理', day: '2026-11-04' },
    ],
  },
  '/api/workhub/projects': {
    projects: [
      { id: 'p1', name: '示例项目 A', origin: 'user', createdAt: '', rules: { aliases: [], keywords: ['DEMO-101', '接口兼容'], chatIds: ['c1'], externalId: null } },
      { id: 'p2', name: '示例项目 B', origin: 'yunxiao', createdAt: '', rules: { aliases: [], keywords: ['DEMO-102', '示例项目 B'], chatIds: [], externalId: 'demo-space-b' } },
      { id: 'p3', name: '示例项目 C', origin: 'yunxiao', createdAt: '', rules: { aliases: [], keywords: ['DEMO-103', '示例项目 C'], chatIds: [], externalId: 'demo-space-c' } },
    ],
  },
  '/api/workhub/sync/status': {
    sources: [
      { source: 'dws.todo', initialDays: 30, state: { status: 'ok', last_sync_at: '2026-11-04T09:00:00Z', total_synced: 42 } },
      { source: 'dws.report', initialDays: 90, state: { status: 'ok', last_sync_at: '2026-11-04T09:00:00Z', total_synced: 18 } },
      { source: 'dws.minutes', initialDays: 90, state: { status: 'ok', last_sync_at: '2026-11-04T09:00:00Z', total_synced: 6 } },
      { source: 'dws.chats', initialDays: 30, state: { status: 'ok', last_sync_at: '2026-11-04T09:00:00Z', total_synced: 32 } },
      { source: 'dws.attendance', initialDays: 31, state: { status: 'ok', last_sync_at: '2026-11-04T09:00:00Z', total_synced: 22 } },
      { source: 'dws.calendar', initialDays: 30, state: { status: 'ok', last_sync_at: '2026-11-04T09:00:00Z', total_synced: 9 } },
      { source: 'yunxiao.projects', initialDays: null, state: { status: 'ok', last_sync_at: '2026-11-04T09:00:00Z', total_synced: 3 } },
      { source: 'yunxiao.workitems', initialDays: null, state: { status: 'ok', last_sync_at: '2026-11-04T09:00:00Z', total_synced: 128 } },
      { source: 'yunxiao.commits', initialDays: null, state: { status: 'ok', last_sync_at: '2026-11-04T09:00:00Z', total_synced: 302 } },
      { source: 'yunxiao.worklogs', initialDays: null, state: { status: 'ok', last_sync_at: '2026-11-04T09:00:00Z', total_synced: 24 } },
    ],
    chats: [
      { conversation_id: 'cid_demo_1', name: '示例技术群', latest_message_time: '2026-11-04 09:20', last_collected_at: '2026-11-04T09:00:00Z', messageCount: 186 },
      { conversation_id: 'cid_demo_2', name: '示例需求群', latest_message_time: '2026-11-04 08:40', last_collected_at: null, messageCount: 0 },
      { conversation_id: 'cid_demo_3', name: '示例运维群', latest_message_time: '2026-11-03 21:10', last_collected_at: null, messageCount: 0 },
    ],
  },
  '/api/workhub/sources': {
    dingtalk: { status: 'connected', account: '示例用户', organization: '示例组织', profile: { current: 'demo', count: 1 }, expiresAt: '2026-11-04T23:00:00Z' },
    yunxiao: { status: 'connected', configured: true, instanceType: 'center', baseUrl: 'https://openapi-rdc.aliyuncs.com', organizationId: 'demo-org', tokenStored: true, credentialStoreSupported: true },
    capabilities: [
      { capability: 'dws.todo', status: 'available' }, { capability: 'dws.report', status: 'available' },
      { capability: 'dws.minutes', status: 'available' }, { capability: 'dws.chats', status: 'available' },
      { capability: 'dws.attendance', status: 'available' }, { capability: 'dws.calendar', status: 'available' },
      { capability: 'yunxiao.projects', status: 'available' }, { capability: 'yunxiao.workitems', status: 'available' },
      { capability: 'yunxiao.commits', status: 'available' }, { capability: 'yunxiao.worklogs', status: 'available' },
    ],
  },
  '/api/workhub/summaries': {
    summaries: [
      {
        date: '2026-11-04', status: 'ready', overview: '上午完成 DEMO-101 接口兼容改造并进入自测；与示例技术群确认灰度范围；下午推进 DEMO-104 埋点补齐。',
        achievements: ['DEMO-101 接口适配完成，兼容旧版返回结构', '示例技术群确认灰度放量节奏（5% → 20%）', '补齐 DEMO-104 埋点清单'],
        metrics: { checkIn: '08:58', checkOut: '18:30', worklogHours: 8.5 },
        sources: new Array(18).fill(0).map(() => ({ sourceType: 'commit' })), generatedAt: '2026-11-04T10:00:00Z',
      },
      {
        date: '2026-11-03', status: 'ready', overview: '集中处理 DEMO-103 联调问题；全天 15 次提交，晚间完成 release 合流。',
        achievements: ['DEMO-103 联调问题定位并修复', 'release 分支合并 4 次'],
        metrics: { checkIn: '09:43', checkOut: '21:17', worklogHours: 10.6 },
        sources: new Array(22).fill(0).map(() => ({ sourceType: 'commit' })), generatedAt: '2026-11-03T22:10:00Z',
      },
    ],
    from: '2026-08-06', to: '2026-11-04',
  },
  '/api/workhub/analytics/project?': {
    project: { id: 'p1', name: '示例项目 A', origin: 'user', rules: { keywords: ['DEMO-101'], aliases: [], chatIds: ['c1'], externalId: null } },
    range: { startDate: '2026-10-05', endDate: '2026-11-04' },
    total: 46, counts: { commit: 24, requirement: 4, chat_message: 8, worklog: 2 },
    insights: [{ id: 'i1', kind: 'insight', payload: { title: '接口兼容性为当前主要风险', description: '近两周 24 条消息讨论网关超时与协议适配，其中 6 条未形成待办。', importance: 'high', origin: 'ai' }, sources: [], generatedAt: '2026-11-04T09:00:00Z' }],
    factStats: { commits: 24, tasks: 3, worklogHours: 38.5, worklogEntries: 4, meetings: 2, attendance: 0, chatMessages: 8, reports: 2, todos: 1, requirements: { 开发中: 2, 测试中: 1, 已完成: 1 } },
    linkedItems: {
      commit: [{ id: 'c1', occurredAt: '2026-11-03', title: 'DEMO-101 接口适配：兼容旧版返回结构' }, { id: 'c2', occurredAt: '2026-11-02', title: 'DEMO-101 缓存层重构' }],
      requirement: [{ id: 'r1', occurredAt: '2026-11-02', title: 'DEMO-101 示例需求：接口兼容改造' }],
    },
    inProgress: [
      { source_id: 'DEMO-107', title: 'DEMO-107 示例网关超时参数调优', status: '架构系分+开发中', day: '2026-11-04' },
      { source_id: 'DEMO-105', title: 'DEMO-105 审计日志接入需求', status: '待处理', day: '2026-11-03' },
      { source_id: 'DEMO-106', title: 'DEMO-106 会员权益行权限制', status: '测试中', day: '2026-11-02' },
    ],
  },
  '/api/workhub/analytics/efficiency?': {
    range: { startDate: '2026-10-06', endDate: '2026-11-04' },
    matrix: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => {
      const workday = d < 5
      if (!workday) return h > 10 && h < 16 && d === 5 ? 3 : 0
      if (h < 9 || h > 21) return 0
      if (h >= 9 && h <= 11) return 4 + ((d + h) % 4)
      if (h >= 14 && h <= 18) return 6 + ((d + h) % 5)
      return 2 + ((d + h) % 3)
    })),
    hourHistogram: Array.from({ length: 24 }, (_, h) => (h < 8 || h > 21 ? 0 : h < 12 ? 18 + h : h < 18 ? 24 + (h % 7) : 9 + (h % 5))),
    topActors: [{ actor: '张三', n: 48 }, { actor: '李四', n: 36 }, { actor: '王五', n: 21 }, { actor: '赵六', n: 14 }, { actor: '孙七', n: 9 }],
  },
  '/api/workhub/actions/pipelines': {
    pipelines: [
      { id: 'pl1', source_id: '5260828', title: '流水线 · 示例项目 A 构建', occurred_at: '2026-09-10' },
      { id: 'pl2', source_id: '5257383', title: '流水线 · 示例项目 B 构建', occurred_at: '2026-09-08' },
      { id: 'pl3', source_id: '5247008', title: '流水线 · 示例项目 A 部署', occurred_at: '2026-09-04' },
    ],
    actions: [
      { id: 'a1', operator: 'ui', action: 'pipeline.run', target: '5260828', status: 'ok', created_at: '2026-11-03T15:20:00Z' },
      { id: 'a2', operator: 'agent', action: 'pipeline.run', target: '5257383', status: 'ok', created_at: '2026-11-02T10:05:00Z' },
      { id: 'a3', operator: 'ui', action: 'appstack.deploy', target: 'demo-web/production', status: 'ok', created_at: '2026-11-03T09:41:00Z' },
    ],
  },
  '/api/workhub/actions/appstack/detail?': {
    app: 'demo-web',
    envs: [
      { name: 'production', displayName: '生产环境', state: 'RUNNING', deployGroup: 'k8s-prod' },
      { name: 'daily', displayName: '日常环境', state: 'DEPLOYING', deployGroup: 'k8s-daily' },
    ],
    orders: [
      { name: '20261103174120-部署-workhub', type: 'Deploy', state: 'SUCCESS', version: '20261103174120-31', createdAt: '2026-11-03T09:41:20.000Z' },
      { name: '20261101153002-部署-flow', type: 'Deploy', state: 'SUCCESS', version: '20261101153002-30', createdAt: '2026-11-01T07:30:02.000Z' },
      { name: '20261028141155-回滚', type: 'Rollback', state: 'FAILED', version: '20261028141155-28', createdAt: '2026-10-28T06:11:55.000Z' },
    ],
    orchestration: { sha: '546566850fc09b1154938f85d79f5bff323787f1', message: '初始化编排', commitTime: '2026-10-22T09:28:52.000Z' },
  },
  '/api/workhub/actions/appstack/prefs': {
    favorites: ['demo-web'],
    notes: { 'demo-web': '生产官网前端，发布前需通知运维' },
  },
  '/api/workhub/actions/appstack': {
    apps: [
      { name: 'demo-web', description: '示例官网前端', template: 'nodejs-common', createdAt: '2026-08-12 10:00:00' },
      { name: 'demo-api', description: '示例服务端', template: 'java-common', createdAt: '2026-08-20 14:30:00' },
    ],
  },
  '/api/workhub/analyses/input/chat?': {
    chat: { name: '示例技术群' },
    stats: { total: 186, byDay: {}, bySender: { 张三: 48, 李四: 36, 王五: 21, 赵六: 14 }, participants: 7 },
    messages: [
      { itemId: 'm1', day: '2026-11-04', sender: '张三', text: 'DEMO-101 的接口文档我下午补齐，大家先按旧结构联调' },
      { itemId: 'm2', day: '2026-11-04', sender: '李四', text: '新网关的超时是不是要先跟运维确认？' },
      { itemId: 'm3', day: '2026-11-03', sender: '王五', text: '灰度实例偶发 502，怀疑超时配置' },
    ],
    sources: new Array(40).fill(0).map(() => ({ sourceType: 'chat_message' })),
  },
  '/api/workhub/items?': { items: [] },
}

/* ------------------------------------------------------------------ */
/* tiny React runtime (no DOM)                                          */
/* ------------------------------------------------------------------ */

function createRuntime() {
  const store = {}
  const storeDeps = {}
  let hookPath = ''
  let cursor = 0
  let effects = []
  let dirty = false

  const h = (type, props, ...children) => {
    const kids = children.filter((c) => c !== null && c !== undefined && c !== false)
    // React 语义：children 同时挂在 props 上，函数组件通过 props.children 取到
    const mergedProps = { ...(props ?? {}), children: kids.length === 1 ? kids[0] : kids }
    return { type, props: mergedProps, children: kids }
  }
  const hookKey = () => `${hookPath}#${cursor++}`
  const useState = (init) => {
    const k = hookKey()
    if (!(k in store)) store[k] = typeof init === 'function' ? init() : init
    return [store[k], (v) => { store[k] = typeof v === 'function' ? v(store[k]) : v; dirty = true }]
  }
  const useEffect = (fn, deps) => {
    const k = hookKey()
    effects.push({ k, fn, deps: JSON.stringify(deps ?? null) })
  }
  const useCallback = (fn) => { hookKey(); return fn }
  const useRef = (init) => {
    const k = hookKey()
    if (!(k in store)) store[k] = { current: init }
    return store[k]
  }

  class Component {
    constructor(props) { this.props = props ?? {} }
  }

  const ReactStub = { createElement: h, useState, useEffect, useCallback, useRef, Component }

  function build(node, path) {
    if (node == null || node === false) return node
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return node.map((n, i) => build(n, `${path}[${i}]`))
    const { type, props, children } = node
    if (typeof type === 'function') {
      if (type.prototype && type.prototype.isReactComponent) return { type, props, children }
      const prev = hookPath
      hookPath = `${path}>${type.name || 'anon'}`
      cursor = 0
      try {
        return build(type(props), hookPath)
      } finally {
        hookPath = prev
      }
    }
    return { type, props, children: children.map((c, i) => build(c, `${path}[${i}]`)) }
  }

  async function render(Comp, props) {
    let tree
    for (let pass = 0; pass < 10; pass++) {
      effects = []
      dirty = false
      const element = build({ type: Comp, props, children: [] }, 'root')
      tree = element
      for (const e of effects) {
        if (storeDeps[e.k] === e.deps) continue
        storeDeps[e.k] = e.deps
        try { e.fn() } catch {}
      }
      await new Promise((r) => setTimeout(r, 8))
      if (!dirty) break
    }
    return tree
  }

  globalThis.fetch = (url) => {
    const key = Object.keys(MOCK).find((k) => String(url).startsWith(k))
    const data = key ? MOCK[key] : {}
    const body = { ok: true, ...JSON.parse(JSON.stringify(data)) }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  }
  return { ReactStub, render }
}

/* ------------------------------------------------------------------ */
/* serialize to HTML                                                    */
/* ------------------------------------------------------------------ */

const UNITLESS = new Set(['opacity', 'fontWeight', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'lineHeight', 'order', 'gridColumn', 'gridRow'])
function styleStr(style) {
  return Object.entries(style || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : v}`)
    .join(';')
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function toHtml(node) {
  if (node == null || node === false) return ''
  if (Array.isArray(node)) return node.map(toHtml).join('')
  if (typeof node !== 'object') return esc(node)
  const { type, props, children } = node
  if (typeof type === 'function') return ''
  if (props.dangerouslySetInnerHTML) return `<${type}>${props.dangerouslySetInnerHTML.__html}</${type}>`
  const attrs = []
  if (props.className) attrs.push(`class="${esc(props.className)}"`)
  if (props.style) attrs.push(`style="${esc(styleStr(props.style))}"`)
  if (props.title) attrs.push(`title="${esc(props.title)}"`)
  const open = attrs.length ? `<${type} ${attrs.join(' ')}>` : `<${type}>`
  return `${open}${children.map(toHtml).join('')}</${type}>`
}

const THEME = `
:root{
  --dsw-alias-bg-base:#ffffff;--dsw-alias-bg-layer-1:#fbfbfd;--dsw-alias-bg-layer-2:#f2f4f7;
  --dsw-alias-bg-overlay:#ffffff;--dsw-alias-border-l1:#e7e9ee;--dsw-alias-border-l2:#d5d9e0;
  --dsw-alias-label-primary:#1f2329;--dsw-alias-label-secondary:#727b8a;
  --dsw-alias-brand-primary:#2f6feb;--dsw-alias-state-error-primary:#d9483b;
  --dsw-alias-state-idle-primary:#9aa3b0;--dsw-alias-state-success-primary:#1f9d68;
  --dsw-alias-state-warn-primary:#b8770a;--dsw-specific-sidebar-fill:#f7f8fb;
  --dsw-alias-surface:transparent;--dsw-alias-surface-raised:transparent;
}
html,body{margin:0;height:100%;background:#fff;font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
#app{height:100%}
body{ -webkit-font-smoothing:antialiased }
`

/* ------------------------------------------------------------------ */
/* page shell for detail screenshots                                    */
/* ------------------------------------------------------------------ */

function shell({ title, sub, navLabel, body, PAGES, h }) {
  const nav = PAGES.map(([id, label]) =>
    h('button', { key: id, className: label === navLabel ? 'wh-nav on' : 'wh-nav' },
      h('span', null, label)))
  return h('div', { className: 'wh-root' },
    h('aside', { className: 'wh-side' },
      h('div', { className: 'wh-brand' },
        h('div', { className: 'wh-brand-mark' }, h('svg', { viewBox: '0 0 24 24', width: 16, height: 16 },
          h('rect', { x: 3, y: 3, width: 8, height: 8, rx: 2, fill: '#fff', opacity: 0.95 }),
          h('rect', { x: 13, y: 3, width: 8, height: 8, rx: 2, fill: '#fff', opacity: 0.5 }),
          h('rect', { x: 3, y: 13, width: 8, height: 8, rx: 2, fill: '#fff', opacity: 0.5 }),
          h('rect', { x: 13, y: 13, width: 8, height: 8, rx: 2, fill: '#fff', opacity: 0.95 }))),
        h('div', null,
          h('div', { className: 'wh-brand-name' }, 'WorkHub'),
          h('div', { className: 'wh-brand-tag' }, '钉钉 × 云效 工作台'))),
      h('div', { className: 'wh-group' }, '分析'),
      nav),
    h('div', { className: 'wh-main' },
      h('header', { className: 'wh-top' },
        h('div', null,
          h('div', { className: 'wh-toolbar', style: { gap: 8 } },
            h('div', { className: 'wh-title' }, title),
            h('div', { className: 'wh-toolbar', style: { gap: 6 } },
              h('button', { className: 'wh-ds-pill', style: { background: 'rgba(22,119,255,.12)', color: '#1677FF' } },
                h('span', { style: { width: 6, height: 6, borderRadius: '50%', background: 'var(--wh-ok)' } }), '钉钉'),
              h('button', { className: 'wh-ds-pill', style: { background: 'rgba(232,93,4,.13)', color: '#C2410C' } },
                h('span', { style: { width: 6, height: 6, borderRadius: '50%', background: 'var(--wh-ok)' } }), '云效'))),
          h('div', { className: 'wh-sub' }, sub))),
      h('div', { className: 'wh-scroll' },
        body)))
}

/* ------------------------------------------------------------------ */

const { ReactStub, render } = createRuntime()
let applyFn = null
globalThis.window = { __ModuleLoader__: { load: (def) => { const r = def.factory((n) => (n === 'react' ? ReactStub : null)); applyFn = r?.apply } }, confirm: () => true }
;(0, eval)(fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8'))

const registered = []
applyFn({ slots: { inject: (_k, fn) => fn(), register: (opts, comp) => { registered.push({ opts, comp }); return () => {} } } })
const Panel = registered.find((r) => r.opts.key === 'workhub')?.comp
const D = globalThis.window.__WORKHUB_DEBUG__
const CSS = D.CSS

function write(name, tree) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${THEME}${CSS}</style></head><body><div id="app">${toHtml(tree)}</div></body></html>`
  fs.writeFileSync(path.join(outDir, `${name}.html`), html)
  console.log('wrote', name + '.html')
}

const pages = Object.fromEntries(D.PAGES.map(([id, label, Comp]) => [id, { label, Comp }]))

async function main() {
  const actionsComp = pages.actions?.Comp
  for (const [id, label, Comp] of D.PAGES) {
    if (id === 'actions') continue // 单独处理：两个 tab 拼一张图
    const props = id === 'dashboard'
      ? { range: { preset: 'this_week', granularity: null, compare: true }, setRange: () => {} }
      : id === 'chats' ? { initialChatId: 'cid_demo_1' }
        : id === 'efficiency' || id === 'projects' ? { range: { preset: 'last_30_days', granularity: null, compare: false } }
          : id === 'reports' ? { range: { preset: 'this_week' } } : null
    const tree = await render(Comp, props)
    write(id, shell({ title: label, sub: '示例数据 · 仅用于展示', navLabel: label, body: tree, PAGES: D.PAGES, h: ReactStub.createElement }))
  }

  // actions：流水线 tab + 应用交付 tab 拼一张图（wrapper 命名不同 → hook 状态隔离）
  if (actionsComp) {
    const tabFlow = await render(function WrapActionsFlow() { return ReactStub.createElement(actionsComp, {}) }, {})
    const tabAppstack = await render(function WrapActionsAppstack() { return ReactStub.createElement(actionsComp, { initialTab: 'appstack' }) }, {})
    write('actions', shell({
      title: '快捷执行', sub: '示例数据 · 仅用于展示', navLabel: '快捷执行', PAGES: D.PAGES, h: ReactStub.createElement,
      body: ReactStub.createElement('div', { className: 'wh-content' }, tabFlow, tabAppstack),
    }))
  }

  // project detail
  const detail = await render(D.ProjectDetail, { projectId: 'p1', onClose: () => {} })
  write('project-detail', shell({
    title: '项目分析', sub: '示例项目 A · 近 30 天分析', navLabel: '项目分析', PAGES: D.PAGES, h: ReactStub.createElement,
    body: ReactStub.createElement('div', { className: 'wh-content' }, detail),
  }))

  // chat detail
  const chatSummary = await render(D.ChatSummarySection, { chatId: 'cid_demo_1' })
  write('chat-detail', shell({
    title: '聊天洞察', sub: '示例技术群 · 会话小结', navLabel: '聊天洞察', PAGES: D.PAGES, h: ReactStub.createElement,
    body: ReactStub.createElement('div', { className: 'wh-content' }, chatSummary),
  }))
}

await main()
