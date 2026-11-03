/**
 * Render smoke test: stub React + fetch, render every WorkHub page with
 * representative mock data; report the component that throws.
 */
import fs from 'node:fs'

function describeChild(c) {
  if (c === null || c === undefined || typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean') return null
  if (Array.isArray(c)) return null
  if (typeof c === 'object' && c.type) return null
  return `INVALID CHILD (React error #31): plain object with keys {${Object.keys(c).join(', ')}}`
}

const ReactStub = {
  createElement(type, props, ...children) {
    const kids = children.filter((c) => c !== null && c !== undefined && c !== false)
    for (const c of kids.flat()) {
      const bad = describeChild(c)
      if (bad) throw new Error(`${bad} — inside <${typeof type === 'function' ? type.name : type}>`)
    }
    return { type, props: props ?? {}, children: kids }
  },
}
class StubComponent {
  constructor(props) { this.props = props ?? {} }
}
ReactStub.Component = StubComponent
ReactStub.useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}]
ReactStub.useEffect = () => {}
ReactStub.useCallback = (fn) => fn

const mock = {
  '/api/workhub/analytics/dashboard?': {
    range: { startDate: '2026-11-01', endDate: '2026-11-03', granularity: 'day', prevStartDate: '2026-10-29', prevEndDate: '2026-10-31' },
    counts: { commit: 33, todo: 38 }, activity: [{ bucket: '2026-11-03', source_type: 'commit', n: 33 }],
    projectActivity: [{ id: 'p1', name: '示例项目', source_type: 'report', n: 5 }],
    activeProjects: 2, compare: { range: {}, counts: { todo: 1 }, activeProjects: 0 },
  },
  '/api/workhub/analyses?': { analyses: [{ id: 'a1', kind: 'insight', scope: {}, payload: { title: 't', description: 'd', importance: 'medium', origin: 'rule' }, sources: [{ sourceType: 'todo' }], generatedAt: '2026-11-03T10:00:00Z' }] },
  '/api/workhub/calendar?': { days: [{ date: '2026-11-03', events: 45, meetings: 0, todos: 38, chats: 3, reports: 4, attendance: 2, commits: 33, requirements: 1, tasks: 0, projects: { AI基建: 2 }, hasSummary: false }] },
  '/api/workhub/calendar/day?': { events: [{ id: 'x', time: '09:43', sourceType: 'attendance', title: '上班', actor: '示例用户', projects: ['示例项目'] }], metrics: { total: 1, byType: { attendance: 1 }, projects: ['示例项目'] }, summary: { status: 'stale', overview: 'o', achievements: ['a'], decisions: [], blockers: [], nextActions: [], sources: [{}], generatedAt: '2026-11-03T10:00:00Z' } },
  '/api/workhub/projects': { projects: [
    { id: 'p1', name: '示例项目', origin: 'user', createdAt: '', rules: { aliases: [], keywords: ['NewAPI'], chatIds: [], externalId: null } },
    { id: 'y1', name: '手充', origin: 'yunxiao', createdAt: '', rules: { aliases: [], keywords: ['SCPRO'], chatIds: [], externalId: 'abc' } }] },
  '/api/workhub/sync/status': { sources: [{ source: 'dws.todo', initialDays: 30, state: { status: 'ok', last_sync_at: '2026-11-03T10:00:00Z', total_synced: 67 } }], chats: [{ conversation_id: 'cid1', name: '测试群', latest_message_time: '2026-11-03 10:00', last_collected_at: '2026-11-03 12:00' }] },
  '/api/workhub/analytics/project?': { project: { id: 'p1', name: '示例项目', origin: 'user', rules: { keywords: [], aliases: [], chatIds: [], externalId: null } }, range: { startDate: 'a', endDate: 'b' }, total: 5, counts: { report: 5 }, insights: [], factStats: { commits: 1, tasks: 0, worklogHours: 8.3, worklogEntries: 1, meetings: 0, attendance: 0, chatMessages: 0, reports: 1, todos: 0, requirements: { 已完成: 4 } }, linkedItems: { report: [{ id: 'r1', occurredAt: '2026-11-01', title: '周报' }] } },
  '/api/workhub/analytics/efficiency?': { range: { startDate: 'a', endDate: 'b' }, matrix: Array.from({ length: 7 }, () => Array(24).fill(1)), hourHistogram: Array(24).fill(1), topActors: [{ actor: '示例用户', n: 11 }] },
  '/api/workhub/analyses/input/chat?': { chat: { name: '测试群' }, stats: { total: 3, byDay: {}, bySender: { 示例用户: 2, 李四: 1 }, participants: 2 }, messages: [{ itemId: 'm1', day: '2026-11-03', sender: '示例用户', text: 'hello' }], sources: [] },
  '/api/workhub/actions/pipelines': { pipelines: [{ id: 'pl1', source_id: '5260828', title: '流水线 · x', occurred_at: '2026-09-10' }], actions: [] },
  '/api/workhub/sources': {
    dingtalk: { status: 'connected', account: '示例用户', organization: '测试', profile: { current: 'x', count: 1 }, expiresAt: '2026-11-03' },
    yunxiao: { status: 'connected', configured: true, instanceType: 'center', baseUrl: 'https://x', organizationId: 'o', tokenStored: true, credentialStoreSupported: true },
    capabilities: [{ capability: 'dws.todo', status: 'available' }],
  },
  '/api/workhub/items?': { items: [{ id: 'i1', source_type: 'todo', title: 't', actor: 'a', occurred_at: '2026-11-03T02:00:00.000Z' }] },
}

globalThis.fetch = (url) => {
  const path = String(url)
  for (const [prefix, data] of Object.entries(mock)) {
    if (path.startsWith(prefix)) return Promise.resolve({ ok: true, json: () => Promise.resolve(data) })
  }
  return Promise.reject(new Error(`unmocked: ${path}`))
}
globalThis.window = {
  __ModuleLoader__: { load: () => {} },
  open: () => {},
  confirm: () => true,
}
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })

let applyFn = null
const loader = {
  load(def) {
    const result = def.factory((n) => (n === 'react' ? ReactStub : null))
    applyFn = result?.apply
  },
}
globalThis.window.__ModuleLoader__ = loader

;(0, eval)(fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'))

const captured = []
applyFn({
  slots: {
    inject: (_slot, fn) => fn(),
    register: (opts, component) => { captured.push({ opts, component }); return () => {} },
  },
})
const panel = captured.find((c) => c.opts.key === 'workhub')?.component
console.log('registered:', captured.map((c) => c.opts.id ?? c.opts.key).join(', '))

function renderTree(node, path, errors) {
  if (!node || Array.isArray(node)) {
    if (Array.isArray(node)) node.forEach((n) => renderTree(n, path, errors))
    return
  }
  if (typeof node === 'object' && node.type) {
    if (typeof node.type === 'function') {
      const name = node.type.name || 'anon'
      try {
        renderTree(node.type(node.props), `${path}>${name}`, errors)
      } catch (e) {
        errors.push(`${path}>${name}: ${e.message}\n    ${e.stack?.split('\n')[1] ?? ''}`)
      }
    } else {
      renderTree(node.children, path, errors)
    }
  }
}

const PAGES = globalThis.window.__WORKHUB_DEBUG__?.PAGES ?? []
const range = { preset: 'last_7_days', granularity: null, compare: false, resolved: { startDate: 'a', endDate: 'b', prevStartDate: 'c', prevEndDate: 'd' } }
let failed = 0
for (const [id, label, Comp] of PAGES) {
  const errors = []
  try {
    // 统一传入 range/setRange：页面各取所需，避免新增时间范围页时因 props 为 null 误报。
    const props = { range, setRange: () => {} }
    renderTree(Comp(props), label, errors)
    if (errors.length) {
      failed++
      console.log(`✗ ${label}`)
      errors.slice(0, 3).forEach((e) => console.log('   ', e))
    } else {
      console.log(`✓ ${label}`)
    }
  } catch (e) {
    failed++
    console.log(`✗ ${label} (top level): ${e.message}\n    ${e.stack?.split('\n')[1] ?? ''}`)
  }
}
const pagesFailed = failed

// ---- data-arrived branches: render subcomponents with realistic props ----
const D = globalThis.window.__WORKHUB_DEBUG__
const subErrors = []
function tryRender(name, el) { renderTree(el, name, subErrors) }

tryRender('ProjectDetail', D.ProjectDetail({ projectId: 'p1' }))
tryRender('DayPanel(data+stale summary)', D.DayPanel({ date: '2026-11-03' }))
tryRender('DayPanel(projectId)', D.DayPanel({ date: '2026-11-03', projectId: 'p1' }))
tryRender('TopicsSection', D.TopicsSection({ chatId: 'cid1' }))
tryRender('Heatmap', D.Heatmap({ matrix: Array.from({ length: 7 }, () => Array(24).fill(2)) }))
tryRender('InsightCard(rule)', D.InsightCard({ a: { payload: { title: 't', description: 'd', importance: 'high', origin: 'rule' }, sources: [{ sourceType: 'todo' }, { sourceType: 'commit' }], generatedAt: '2026-11-03T10:00:00Z' } }))
tryRender('InsightCard(no payload)', D.InsightCard({ a: { payload: null, sources: [], generatedAt: '2026-11-03T10:00:00Z' } }))
tryRender('Stat', D.Stat({ label: '工作事件', value: 42, hint: 'x' }))
tryRender('TimeBar(company)', D.TimeBar({ range: { preset: 'company_period', granularity: null, compare: false, resolved: { startDate: 'a', endDate: 'b' } }, onChange: () => {} }))
tryRender('TimeBar(custom)', D.TimeBar({ range: { preset: 'custom', start: '2026-10-30', end: '2026-11-05', granularity: null, compare: true, resolved: { startDate: 'a', endDate: 'b' } }, onChange: () => {} }))

if (subErrors.length) {
  console.log('\nSUBCOMPONENT FAILURES:')
  subErrors.forEach((e) => console.log('  ✗', e))
} else {
  console.log('\nsubcomponents: all OK')
}

process.exit((pagesFailed || subErrors.length) ? 1 : 0)
