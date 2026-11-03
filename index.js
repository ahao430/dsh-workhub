/**
 * WorkHub Host half.
 * M2–M5: storage + collectors + sync API + analytics + agent tools (read-mostly).
 */
import { createWorkHubRouter } from './lib/api.js'
import { registerWorkHubTools } from './lib/tools.js'

export const inject = ['webServer', 'tools']

export function apply(ctx) {
  const router = createWorkHubRouter({})
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: router.prefix, handler: router.handler }))

  // Scheduled incremental sync (v2 §3.3): every 30 minutes; failures land in
  // sync_state and never throw out of the timer.
  ctx.effect(() => {
    const timer = setInterval(() => {
      router.sync.run('all').then(() => router.sync.runWatchdog()).catch(() => {})
    }, 30 * 60 * 1000)
    return () => clearInterval(timer)
  })

  registerWorkHubTools(ctx, router)

  return () => router.db.close()
}
