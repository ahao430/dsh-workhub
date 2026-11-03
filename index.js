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
    const timer = setInterval(async () => {
      // 需要重新登录时跳过同步（避免每 30 分钟刷失败日志），只让 Watchdog 提示一次
      const health = await router.dws.getHealth().catch(() => null)
      if (health && health.refreshTokenValid === false) {
        await router.sync.runWatchdog().catch(() => {})
        return
      }
      await router.sync.run('all').catch(() => {})
      await router.sync.runWatchdog().catch(() => {})
    }, 30 * 60 * 1000)
    return () => clearInterval(timer)
  })

  registerWorkHubTools(ctx, router)

  return () => {
    try { router.dispose?.() } catch {}
    router.db.close()
  }
}
