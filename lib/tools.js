/**
 * Agent Tools — the LLM-facing surface of WorkHub. Tools read the local
 * data layer only (never spawn dws). Insight flow (v2 §2 / §5.4):
 *   workhub_get_project_analysis_input -> LLM reasons (in-session, logged)
 *   -> workhub_save_insight (payload + mandatory source item ids)
 */
export function registerWorkHubTools(ctx, router) {
  const { db, sync } = router

  const objectOutput = {
    schema: { type: 'object' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_status',
      description:
        'WorkHub data-hub status: local SQLite item counts per source, dws CLI auth state, and last-sync states. Read-only.',
      parameters: { type: 'object', properties: {} },
      output: objectOutput,
      async execute() {
        return { ok: true, db: db.filePath, counts: db.countItems(), sources: sync.listSources() }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_sync',
      description:
        'Run a WorkHub data collection pass (todo/report/minutes/chat-registry sources, or "all"). Safe to re-run; upserts by source id. Read-only toward DingTalk.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            enum: ['all', 'dws.todo', 'dws.report', 'dws.minutes', 'dws.chats'],
          },
        },
      },
      output: objectOutput,
      async execute(args) {
        return { ok: true, results: await sync.run(args?.source ?? 'all') }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_search_items',
      description:
        'Search WorkHub local work items by source type: todo | report | minutes | chat_message. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          sourceType: { type: 'string', enum: ['todo', 'report', 'minutes', 'chat_message'] },
          chatId: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      output: objectOutput,
      async execute(args) {
        return {
          ok: true,
          items: db.listWorkItems({
            sourceType: args?.sourceType,
            chatId: args?.chatId,
            limit: args?.limit ?? 50,
          }),
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_list_projects',
      description:
        'List WorkHub projects with their resolution rules (keywords, aliases, bound chats) and link counts. Read-only.',
      parameters: { type: 'object', properties: {} },
      output: objectOutput,
      async execute() {
        return { ok: true, projects: db.listProjects(), resolve: null }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_get_project_analysis_input',
      description:
        'Assemble the deterministic analysis input for one project: linked work items of the last N days, grouped by source, each with a source reference. Use this before analyzing a project; every insight you produce must cite these item ids. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project id from workhub_list_projects.' },
          days: { type: 'number', description: 'Look-back window in days (default 14).' },
        },
        required: ['projectId'],
      },
      output: objectOutput,
      async execute(args) {
        const input = db.projectAnalysisInput(String(args?.projectId ?? ''), args?.days ?? 14)
        return { ok: true, ...input }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_save_insight',
      description:
        'Persist one AI insight into WorkHub after analyzing data (e.g. via workhub_get_project_analysis_input). Every insight MUST cite evidenceItemIds from that input; do not state numbers the analytics layer did not produce. Write.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['insight', 'topic_cluster', 'project_summary'] },
          title: { type: 'string' },
          description: { type: 'string' },
          importance: { type: 'string', enum: ['low', 'medium', 'high'] },
          projectId: { type: 'string' },
          evidenceItemIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'work_items ids cited as evidence (from the analysis input sources).',
          },
        },
        required: ['kind', 'title', 'description', 'evidenceItemIds'],
      },
      output: objectOutput,
      async execute(args) {
        const evidence = db.sourcesForItems(args?.evidenceItemIds ?? [])
        if (!evidence.length) {
          throw new Error('insight rejected: no resolvable evidenceItemIds — every insight needs traceable sources')
        }
        const analysis = db.saveAnalysis({
          kind: args?.kind ?? 'insight',
          scope: { projectId: args?.projectId ?? null },
          payload: {
            title: String(args?.title ?? ''),
            description: String(args?.description ?? ''),
            importance: args?.importance ?? 'medium',
          },
          sources: evidence,
          model: 'dsh-agent',
        })
        return { ok: true, analysis }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_get_day_analysis_input',
      description:
        'Assemble the deterministic input for one day\'s work summary (date YYYY-MM-DD): the day\'s work events (chat/todo/report/minutes) with project tags, per-type metrics, byPerson (per department-member commits/inProgress/chats), and source references. Use before generating a daily summary or answering "what did I do that day". Read-only.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          projectId: { type: 'string', description: 'Optional: restrict to one project.' },
        },
        required: ['date'],
      },
      output: objectOutput,
      async execute(args) {
        return { ok: true, ...db.dayAnalysisInput(String(args?.date ?? ''), args?.projectId) }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_save_daily_summary',
      description:
        'Persist the AI daily work summary for one date into the WorkHub calendar. Every summary MUST cite evidenceItemIds from workhub_get_day_analysis_input; do not state numbers the metrics layer did not produce. Write (upserts by date).',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          overview: { type: 'string' },
          achievements: { type: 'array', items: { type: 'string' } },
          decisions: { type: 'array', items: { type: 'string' } },
          blockers: { type: 'array', items: { type: 'string' } },
          nextActions: { type: 'array', items: { type: 'string' } },
          evidenceItemIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['date', 'overview', 'evidenceItemIds'],
      },
      output: objectOutput,
      async execute(args) {
        const evidence = db.sourcesForItems(args?.evidenceItemIds ?? [])
        if (!evidence.length) {
          throw new Error('summary rejected: no resolvable evidenceItemIds')
        }
        const summary = db.saveDailySummary({
          date: String(args?.date ?? ''),
          overview: String(args?.overview ?? ''),
          achievements: args?.achievements ?? [],
          decisions: args?.decisions ?? [],
          blockers: args?.blockers ?? [],
          nextActions: args?.nextActions ?? [],
          sources: evidence,
        })
        return { ok: true, summary }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_get_chat_analysis_input',
      description:
        'Assemble the deterministic analysis input for one chat: messages of the last N days with per-day/per-sender stats and source references. The chat must have been collected first (数据管理 → 采集). Use before topic clustering or chat summaries. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'conversationId from WorkHub chats.' },
          days: { type: 'number', description: 'Look-back window (default 14).' },
        },
        required: ['chatId'],
      },
      output: objectOutput,
      async execute(args) {
        return { ok: true, ...db.chatAnalysisInput(String(args?.chatId ?? ''), args?.days ?? 14) }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_get_report_input',
      description:
        'Assemble the deterministic input for a report (daily/weekly/project): period metrics, previous-period comparison, byPerson (per department-member commits/inProgress/chats for the period — use it to draft per-person sections when asked for individual-dimension summaries), and linked items with source references. LLM drafts the report from this; save via workhub_save_report. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Optional: restrict to one project (project stage report).' },
          days: { type: 'number', description: 'Report window in days (default 7).' },
        },
      },
      output: objectOutput,
      async execute(args) {
        return { ok: true, ...db.reportInput({ projectId: args?.projectId, days: args?.days ?? 7 }) }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_save_report',
      description:
        'Persist a report draft (kind: report_draft) into WorkHub. Returns a draft only — WorkHub never submits reports to DingTalk. evidenceItemIds required. Write.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          overview: { type: 'string' },
          periodDays: { type: 'number' },
          projectId: { type: 'string' },
          sections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['title', 'content'],
            },
          },
          evidenceItemIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'overview', 'sections', 'evidenceItemIds'],
      },
      output: objectOutput,
      async execute(args) {
        const evidence = db.sourcesForItems(args?.evidenceItemIds ?? [])
        if (!evidence.length) throw new Error('report rejected: no resolvable evidenceItemIds')
        const analysis = db.saveAnalysis({
          kind: 'report_draft',
          scope: { projectId: args?.projectId ?? null, periodDays: args?.periodDays ?? null },
          payload: {
            title: String(args?.title ?? ''),
            overview: String(args?.overview ?? ''),
            sections: args?.sections ?? [],
          },
          sources: evidence,
          model: 'dsh-agent',
        })
        return { ok: true, analysis }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_list_pipelines',
      description:
        'List Yunxiao Flow pipelines known to WorkHub (from the last yunxiao.pipelines sync) and the recent WorkHub action log. Read-only.',
      parameters: { type: 'object', properties: {} },
      output: objectOutput,
      async execute() {
        return {
          ok: true,
          pipelines: db.listWorkItems({ sourceType: 'pipeline', limit: 100 }),
          recentActions: db.listActions(10),
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_run_pipeline',
      description:
        'Run one Yunxiao Flow pipeline (WRITE). You MUST first describe the pipeline to the user and obtain their explicit consent, then pass userConfirmed=true. Never call this with userConfirmed=false or without asking. The call is recorded in the WorkHub action log.',
      parameters: {
        type: 'object',
        properties: {
          pipelineId: { type: 'string', description: 'Numeric Yunxiao pipeline id (from workhub_list_pipelines).' },
          userConfirmed: { type: 'boolean', description: 'Must be true after the user explicitly agreed.' },
        },
        required: ['pipelineId', 'userConfirmed'],
      },
      output: objectOutput,
      async execute(args, exec) {
        const pipelineId = String(args?.pipelineId ?? '')
        if (!/^\d+$/.test(pipelineId)) throw new Error('invalid pipelineId')
        if (args?.userConfirmed !== true) {
          throw new Error('refused: pipeline.run requires explicit user confirmation (ask first, then pass userConfirmed=true)')
        }
        const { YunxiaoClient } = await import('./yunxiao/client.js')
        const yx = new YunxiaoClient({ db, credentials: router.credentials })
        try {
          const runId = await yx.runPipeline(pipelineId)
          db.logAction({ operator: 'agent', action: 'pipeline.run', target: pipelineId, status: 'ok', result: { runId } })
          return { ok: true, runId }
        } catch (e) {
          db.logAction({ operator: 'agent', action: 'pipeline.run', target: pipelineId, status: 'error', result: { error: String(e?.message || e) } })
          throw e
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_save_topic_cluster',
      description:
        'Persist a chat topic-cluster analysis (kind: topic_cluster) into WorkHub after analyzing chat data via workhub_get_chat_analysis_input. Every topic MUST cite evidenceItemIds from that input. Write.',
      parameters: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'conversationId of the analyzed chat.' },
          chatName: { type: 'string' },
          topics: {
            type: 'array',
            description: 'Detected topics.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                status: { type: 'string', description: 'emerging | discussing | decided | implementing | resolved | dormant' },
                summary: { type: 'string' },
                evidenceItemIds: { type: 'array', items: { type: 'string' } },
              },
              required: ['name', 'evidenceItemIds'],
            },
          },
        },
        required: ['chatId', 'topics'],
      },
      output: objectOutput,
      async execute(args) {
        const allEvidence = []
        for (const t of args?.topics ?? []) {
          for (const id of t.evidenceItemIds ?? []) allEvidence.push(id)
        }
        const evidence = db.sourcesForItems([...new Set(allEvidence)])
        if (!evidence.length) throw new Error('cluster rejected: no resolvable evidenceItemIds')
        const analysis = db.saveAnalysis({
          kind: 'topic_cluster',
          scope: { chatId: args.chatId },
          payload: { chatName: args?.chatName ?? null, topics: args?.topics ?? [] },
          sources: evidence,
          model: 'dsh-agent',
        })
        return { ok: true, analysis }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workhub_list_insights',
      description: 'List saved WorkHub analyses/insights, optionally filtered by kind or projectId. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['insight', 'topic_cluster', 'report_draft', 'project_summary'] },
          projectId: { type: 'string' },
        },
      },
      output: objectOutput,
      async execute(args) {
        return { ok: true, analyses: db.listAnalyses(args ?? {}) }
      },
    }),
  )
}
