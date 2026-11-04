/**
 * DingTalk re-login host process.
 *
 * `dws auth login` uses the OAuth Loopback flow: it starts a 127.0.0.1 listener
 * and opens the system browser. Since the DSH Host runs on the same machine as
 * the user, spawning it from the panel gives a true one-click re-login.
 *
 * We keep the child process, stream its stdout/stderr (to surface the auth URL
 * or a device-flow user_code), and expose a pollable status snapshot.
 */
import { spawn } from 'node:child_process'

const MAX_OUTPUT = 8000
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

/** SIGTERM 后 5s 仍未退出则 SIGKILL：确保 close 必然触发，job 不会卡在 running 锁死 start()。 */
const killWithEscalation = (child) => {
  try { child.kill('SIGTERM') } catch {}
  const t = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 5_000)
  if (t.unref) t.unref()
}

export class DingTalkLogin {
  constructor() {
    this.job = null
    this.child = null
  }

  start() {
    if (this.job?.status === 'running') {
      return { started: false, status: 'running', job: this.snapshot() }
    }
    const job = {
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      output: '',
      url: null,
      code: null,
      error: null,
      exitCode: null,
    }
    this.job = job

    let child
    try {
      child = spawn('dws', ['auth', 'login'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        env: { ...process.env, DWS_LANG: process.env.DWS_LANG ?? 'zh' },
      })
    } catch (e) {
      job.status = 'error'
      job.error = String(e?.message || e)
      return { started: false, status: 'error', job: this.snapshot() }
    }
    this.child = child

    const absorb = (buf) => {
      job.output = (job.output + String(buf)).slice(-MAX_OUTPUT)
      if (!job.url) {
        const m = /https?:\/\/[^\s"'）)。，]+/.exec(job.output)
        if (m) job.url = m[0]
      }
      if (!job.code) {
        const m = /(?:user_code|设备码|授权码|code)[\s:：]*([A-Z0-9][A-Z0-9-]{3,})/i.exec(job.output)
        if (m) job.code = m[1]
      }
    }
    child.stdout.on('data', absorb)
    child.stderr.on('data', absorb)

    const timer = setTimeout(() => {
      if (this.child === child) {
        job.error = job.error ?? '登录等待超时（5 分钟）'
        if (job.status === 'running') job.status = 'error' // 立即解锁，允许重新发起登录
        killWithEscalation(child)
      }
    }, LOGIN_TIMEOUT_MS)

    child.on('error', (e) => {
      clearTimeout(timer)
      job.status = 'error'
      job.error = String(e?.message || e)
      job.finishedAt = new Date().toISOString()
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      job.exitCode = code
      job.finishedAt = new Date().toISOString()
      job.status = code === 0 ? 'done' : 'error'
      if (code !== 0 && !job.error) job.error = `dws auth login 退出码 ${code}`
      if (this.child === child) this.child = null
    })

    return { started: true, status: 'running', job: this.snapshot() }
  }

  snapshot() {
    if (!this.job) return null
    const j = this.job
    return {
      status: j.status,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      exitCode: j.exitCode,
      url: j.url,
      code: j.code,
      error: j.error,
      outputTail: j.output.slice(-1200),
    }
  }

  /** Kill a running login (plugin unload / user cancel). */
  cancel() {
    if (this.child) {
      killWithEscalation(this.child)
      this.child = null
    }
    if (this.job?.status === 'running') {
      this.job.status = 'error'
      this.job.error = '已取消'
    }
  }

  dispose() {
    this.cancel()
  }
}
