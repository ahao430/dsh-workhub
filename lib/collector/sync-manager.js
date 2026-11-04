/**
 * SyncManager — runs collectors, records sync_state, exposes status.
 * One sync per source at a time (in-process guard).
 */
import { allCollectors, collectChatMessages } from './index.js'
import { yunxiaoCollectors } from './yunxiao.js'
import { Watchdog } from '../watchdog.js'

const COLLECTORS = [...allCollectors, ...yunxiaoCollectors]

export class SyncManager {
  constructor({ db, dws, credentials }) {
    this.db = db
    this.dws = dws
    this.credentials = credentials
    this.watchdog = new Watchdog(db)
    this._running = new Set()
  }

  /** Run watchdog rules; safe on timer (never throws). */
  async runWatchdog() {
    try {
      const health = await this.dws.getHealth().catch(() => null)
      return this.watchdog.run(health)
    } catch {
      return []
    }
  }

  listSources() {
    const stored = new Map(this.db.listSyncState().map((r) => [r.source, r]))
    return COLLECTORS.map((c) => ({
      source: c.source,
      initialDays: c.initialDays,
      state: stored.get(c.source) ?? null,
    }))
  }

  async run(source = 'all') {
    const targets =
      source === 'all'
        ? COLLECTORS
        : COLLECTORS.filter((c) => c.source === source)
    if (!targets.length) throw new Error(`unknown source: ${source}`)
    const results = {}
    const runOne = async (c) => {
      if (this._running.has(c.source)) {
        results[c.source] = { status: 'already-running' }
        return
      }
      this._running.add(c.source)
      this.db.setSyncState(c.source, { status: 'syncing' })
      try {
        const r = await c.collect({ db: this.db, dws: this.dws, credentials: this.credentials })
        // 采集器可返回 syncStatus='partial'（如考勤部分日期失败）与 cursor（增量游标）
        this.db.setSyncState(c.source, {
          status: r?.syncStatus === 'partial' ? 'partial' : 'ok',
          totalSynced: r.upserted,
          error: r?.syncStatus === 'partial' && r?.detail?.failedDays?.length
            ? `部分日期拉取失败：${r.detail.failedDays.join('、')}`
            : null,
          cursor: r?.cursor ?? null,
        })
        results[c.source] = { status: r?.syncStatus ?? 'ok', ...r }
      } catch (error) {
        this.db.setSyncState(c.source, { status: 'error', error: String(error?.message || error) })
        results[c.source] = { status: 'error', error: String(error?.message || error) }
      } finally {
        this._running.delete(c.source)
      }
    }
    if (source === 'all') {
      // 各数据源相互独立：并行执行（此前 13 源串行，总时长为各源之和）。
      // dws 侧由 DwsExecutor 3 并发限流兜底；SQLite 写入在单线程事件循环天然串行。
      await Promise.all(targets.map(runOne))
    } else {
      for (const c of targets) await runOne(c)
    }
    return results
  }

  runChatMessages(conversationId, sinceDays = 14) {
    if (this._running.has(`chat:${conversationId}`)) {
      return Promise.resolve({ status: 'already-running' })
    }
    this._running.add(`chat:${conversationId}`)
    return collectChatMessages({ db: this.db, dws: this.dws, conversationId, sinceDays }).finally(
      () => this._running.delete(`chat:${conversationId}`),
    )
  }
}
