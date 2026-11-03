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
    for (const c of targets) {
      if (this._running.has(c.source)) {
        results[c.source] = { status: 'already-running' }
        continue
      }
      this._running.add(c.source)
      this.db.setSyncState(c.source, { status: 'syncing' })
      try {
        const r = await c.collect({ db: this.db, dws: this.dws, credentials: this.credentials })
        this.db.setSyncState(c.source, {
          status: 'ok',
          totalSynced: r.upserted,
          error: null,
        })
        results[c.source] = { status: 'ok', ...r }
      } catch (error) {
        this.db.setSyncState(c.source, { status: 'error', error: String(error?.message || error) })
        results[c.source] = { status: 'error', error: String(error?.message || error) }
      } finally {
        this._running.delete(c.source)
      }
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
