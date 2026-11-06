/**
 * Yunxiao collectors (v3 §4.2). Read-only. Each collector degrades to a
 * permission-denied sync_state entry instead of failing the whole sync.
 */
import { YunxiaoClient } from '../yunxiao/client.js'

const nowIso = () => new Date().toISOString()

function makeClient(ctx) {
  return new YunxiaoClient({ db: ctx.db, credentials: ctx.credentials })
}

/* Projex 项目 → Project 实体（keywords = customCode + name，供规则归集跨系统关联） */
export const yunxiaoProjectsCollector = {
  source: 'yunxiao.projects',
  async collect(ctx) {
    const yx = makeClient(ctx)
    const rows = await yx.searchProjects({ page: 1, pageSize: 100 })
    let n = 0
    for (const p of rows ?? []) {
      const keywords = [...new Set([p.customCode, p.name].filter(Boolean))]
      ctx.db.upsertYunxiaoProject({
        externalId: String(p.id ?? p.identifier ?? p.customCode ?? p.name),
        name: p.name,
        keywords,
        raw: p,
      })
      n++
    }
    // a project row is a fact worth one timeline event too (creation)
    const events = (rows ?? []).map((p) => ({
      source_type: 'yunxiao_project',
      source_id: String(p.id ?? p.identifier ?? p.customCode ?? p.name),
      title: `云效项目 · ${p.name}${p.customCode ? ` (${p.customCode})` : ''}`,
      actor: p.creator?.name ?? null,
      occurred_at: p.gmtCreate ? new Date(Number(p.gmtCreate)).toISOString() : nowIso(),
      raw_json: p,
    }))
    ctx.db.upsertWorkItems(events)
    return { upserted: n, fetched: n }
  },
}

/* Codeup 仓库注册表 */
export const yunxiaoReposCollector = {
  source: 'yunxiao.repos',
  async collect(ctx) {
    const yx = makeClient(ctx)
    const rows = await yx.listRepositories({ page: 1, pageSize: 100 })
    const events = (rows ?? []).map((r) => ({
      source_type: 'git_repo',
      source_id: String(r.id ?? r.httpUrlToRepo ?? r.name),
      title: `代码仓库 · ${r.name ?? r.pathWithNamespace}`,
      content: r.httpUrlToRepo ?? null,
      actor: null,
      occurred_at: r.createdAt ? new Date(r.createdAt).toISOString() : nowIso(),
      raw_json: r,
    }))
    return { upserted: ctx.db.upsertWorkItems(events), fetched: events.length }
  },
}

/* Flow 流水线 */
export const yunxiaoPipelinesCollector = {
  source: 'yunxiao.pipelines',
  async collect(ctx) {
    const yx = makeClient(ctx)
    const rows = await yx.listPipelines({ page: 1, pageSize: 100 })
    const events = (rows ?? []).map((p) => ({
      source_type: 'pipeline',
      source_id: String(p.pipelineId),
      title: `流水线 · ${p.pipelineName}`,
      actor: null,
      occurred_at: p.createTime ? new Date(Number(p.createTime)).toISOString() : nowIso(),
      raw_json: p,
    }))
    return { upserted: ctx.db.upsertWorkItems(events), fetched: events.length }
  },
}

const MILESTONE_FIELDS = [
  ['计划开始时间', '计划开始'],
  ['计划提测时间', '计划提测'],
  ['计划完成时间', '计划完成'],
  ['需求评审通过时间', '评审通过'],
  ['技术提供排期时间', '技术排期'],
  ['期望上线时间', '期望上线'],
]

/** Pull scheduling milestones out of a Yunxiao workitem's custom fields. */
function extractMilestones(w, sourceType) {
  const serial = w.serialNumber ?? String(w.id)
  const out = []
  for (const field of w.customFieldValues ?? []) {
    const hit = MILESTONE_FIELDS.find(([name]) => name === field.fieldName)
    if (!hit) continue
    const raw = field.values?.[0]?.displayValue
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? ''))
    if (!m) continue
    const date = `${m[1]}-${m[2]}-${m[3]}`
    out.push({
      date,
      event: {
        source_type: 'milestone',
        source_id: `${serial}:${hit[0]}`,
        title: `${serial} ${hit[1]}`,
        content: `${w.subject ?? ''}${w.status?.displayName ? ` · ${w.status.displayName}` : ''}`,
        actor: w.assignedTo?.name ?? null,
        occurred_at: new Date(`${date}T10:00:00+08:00`).toISOString(),
        raw_json: { serial, field: hit[0], label: hit[1], date, subject: w.subject, status: w.status?.displayName, space: w.space?.name },
      },
    })
  }
  return out
}

/* Projex 工作项（需求/任务）→ 直连所属云效项目（space 事实，非关键词推断） */
export const yunxiaoWorkitemsCollector = {
  source: 'yunxiao.workitems',
  async collect(ctx) {
    const yx = makeClient(ctx)
    const projects = ctx.db.listProjects().filter((p) => p.origin === 'yunxiao')
    const events = []
    const directLinks = []
    for (const project of projects) {
      for (const category of ['Req', 'Task']) {
        let rows
        try {
          rows = await yx.searchWorkitems({ category, spaceId: project.rules.externalId, perPage: 30 })
        } catch (e) {
          if (e.code === 'yunxiao-permission-denied') continue
          throw e
        }
        for (const w of rows ?? []) {
          const sourceType = category === 'Req' ? 'requirement' : 'task'
          events.push({
            source_type: sourceType,
            source_id: w.serialNumber ?? String(w.id),
            title: `${w.serialNumber ?? ''} ${w.subject ?? ''}`.trim(),
            content: w.status?.displayName ?? null,
            actor: w.assignedTo?.name ?? w.creator?.name ?? null,
            occurred_at: w.gmtCreate ? new Date(Number(w.gmtCreate)).toISOString() : nowIso(),
            raw_json: w,
          })
          directLinks.push({ entityId: project.id, itemId: `${sourceType}:${w.serialNumber ?? w.id}`, reason: 'yunxiao-space' })
          // 排期节点：需求自定义字段里的计划/提测/完成时间 → milestone 事件
          for (const m of extractMilestones(w, sourceType)) {
            events.push(m.event)
            directLinks.push({ entityId: project.id, itemId: m.event.source_type + ':' + m.event.source_id, reason: 'yunxiao-space' })
          }
        }
      }
    }
    const upserted = ctx.db.upsertWorkItems(events)
    for (const l of directLinks) ctx.db.linkItemToProject(l.entityId, l.itemId, l.reason)
    return { upserted, fetched: events.length, detail: { projects: projects.length } }
  },
}

/* Codeup Commits（近 30 天：默认分支保底 + 活跃 feature 分支，每分支首页 50 条） */
export const yunxiaoCommitsCollector = {
  source: 'yunxiao.commits',
  async collect(ctx) {
    const yx = makeClient(ctx)
    const repos = ctx.db.listWorkItems({ sourceType: 'git_repo', limit: 200 })
    const sinceMs = Date.now() - 30 * 86_400_000
    const since = new Date(sinceMs).toISOString().slice(0, 19) + 'Z'
    const DEFAULT_REFS = ['master', 'main', 'develop']
    const events = []
    let featureBranches = 0
    for (const repo of repos) {
      const repoId = repo.source_id
      const mk = (c, branch) => ({
        source_type: 'commit',
        source_id: c.id ?? `${repoId}:${c.shortId}`,
        title: c.title ?? '(commit)',
        content: repo.title,
        actor: c.authorName ?? null,
        occurred_at: c.authoredDate ?? c.committedDate ?? nowIso(),
        // branch 入 raw_json：需求号常只在分支名上（feature/QYPRO-511），
        // 主力需求 / 进行中需求 / 周报的需求号提取都要标题→分支兜底
        raw_json: { ...c, branch: branch ?? null },
      })
      // 1) 默认分支（保底，行为与旧版一致）
      let commits = []
      let usedRef = null
      for (const refName of DEFAULT_REFS) {
        try {
          const rows = await yx.listCommits({ repositoryId: repoId, refName, since, pageSize: 50 })
          if (Array.isArray(rows) && rows.length) { commits = rows; usedRef = refName; break }
        } catch (e) {
          if (e.code === 'yunxiao-permission-denied') break
          // 404 branch: try next
        }
      }
      for (const c of commits ?? []) events.push(mk(c, usedRef))
      // 2) 活跃 feature 分支：近 30 天内有提交的非默认分支（updated_desc 前 10 个）。
      //    同一 commit 同时在默认与 feature 分支时，feature 版后写覆盖 → 保留分支归属
      let branches = []
      try { branches = (await yx.listBranches({ repositoryId: repoId })) ?? [] } catch { /* 老网关无此接口 */ }
      const active = branches
        .filter((b) => b?.name && !DEFAULT_REFS.includes(b.name) && b.name !== usedRef)
        .filter((b) => {
          const t = Date.parse(b?.commit?.committedDate ?? '')
          return Number.isFinite(t) && t >= sinceMs
        })
        .slice(0, 10)
      for (const b of active) {
        try {
          const rows = (await yx.listCommits({ repositoryId: repoId, refName: b.name, since, pageSize: 50 })) ?? []
          for (const c of rows) events.push(mk(c, b.name))
          featureBranches += 1
        } catch { /* 分支可能刚被删除/无权限 */ }
      }
    }
    return { upserted: ctx.db.upsertWorkItems(events), fetched: events.length, detail: { repos: repos.length, featureBranches } }
  },
}

/* 报工（effort records，近 90 天）→ 经 workitemId 事实链关联项目 */
export const yunxiaoWorklogsCollector = {
  source: 'yunxiao.worklogs',
  async collect(ctx) {
    const yx = makeClient(ctx)
    const startDate = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
    const endDate = new Date().toISOString().slice(0, 10)
    const records = await yx.listEffortRecords({ startDate, endDate })
    const events = (records ?? []).map((r) => ({
      source_type: 'worklog',
      source_id: String(r.id),
      title: `${r.actualTime ?? '?'}h ${r.workType ?? ''}${r.description ? ` · ${r.description}` : ''}`.trim(),
      actor: r.owner?.name ?? null,
      occurred_at: r.gmtStart ? new Date(Number(r.gmtStart)).toISOString() : nowIso(),
      raw_json: r,
    }))
    const upserted = ctx.db.upsertWorkItems(events)
    // link worklog → project through its workitem's existing project links
    const workitems = ctx.db.db.prepare(
      "SELECT source_type, source_id, raw_json FROM work_items WHERE source_type IN ('requirement','task')",
    ).all() || []
    const workitemIdToSerial = new Map()
    for (const r of workitems) {
      try {
        const raw = JSON.parse(r.raw_json || '{}')
        if (raw.id) workitemIdToSerial.set(String(raw.id), { serial: r.source_id, type: r.source_type })
      } catch {}
    }
    const projectOfItem = {}
    for (const l of ctx.db.db.prepare('SELECT entity_id, item_id FROM entity_links').all() || []) {
      projectOfItem[l.item_id] = l.entity_id
    }
    let links = 0
    for (const rec of records ?? []) {
      const wi = workitemIdToSerial.get(String(rec.workitemId))
      const entityId = wi && projectOfItem[`${wi.type}:${wi.serial}`]
      if (entityId) {
        ctx.db.linkItemToProject(entityId, `worklog:${rec.id}`, 'yunxiao-workitem')
        links++
      }
    }
    return { upserted, fetched: events.length, detail: { projectLinks: links } }
  },
}

export const yunxiaoCollectors = [
  yunxiaoProjectsCollector,
  yunxiaoReposCollector,
  yunxiaoPipelinesCollector,
  yunxiaoWorkitemsCollector,
  yunxiaoCommitsCollector,
  yunxiaoWorklogsCollector,
]
