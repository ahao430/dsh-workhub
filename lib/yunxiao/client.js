import { request } from 'node:https'

/**
 * Yunxiao OpenAPI client (central station: openapi-rdc.aliyuncs.com).
 * Auth: PAT via x-yunxiao-token header; the token lives in the OS keychain
 * (CredentialStore), never in SQLite. Path convention:
 *   /oapi/v1/<service>/organizations/{orgId}/...   (central)
 * Region org domains use /oapi/v1/<service>/... without the org segment.
 */
const DEFAULT_BASE = 'https://openapi-rdc.aliyuncs.com'

/** Plain HTTPS request via node:https (Host's fetch showed different routing). */
function httpsJson(urlStr, { method = 'GET', headers = {}, body, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(urlStr, { method, headers, timeout: timeoutMs }, (res) => {
      const chunks = []
      res.on('data', (c) => {
        chunks.push(c)
        if (chunks.reduce((n, b) => n + b.length, 0) > 8 * 1024 * 1024) req.destroy()
      })
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        try { resolve({ status: res.statusCode, data: JSON.parse(text) }) }
        catch { resolve({ status: res.statusCode, data: text }) }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('yunxiao request timeout')) })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

export class YunxiaoClient {
  constructor({ db, credentials }) {
    this.db = db
    this.credentials = credentials
    this.base = null
    this.token = null
    this.orgId = null
    this.user = null
  }

  async ensureReady() {
    if (this.base) return
    this.base = this.db.getSetting('yunxiao.baseUrl', DEFAULT_BASE)
    const ref = this.db.getSetting('yunxiao.credentialRef')
    this.token = ref ? await this.credentials.get(ref) : null
    if (!this.token) {
      const e = new Error('yunxiao PAT not configured')
      e.code = 'yunxiao-not-configured'
      throw e
    }
    this.central = this.db.getSetting('yunxiao.instanceType', 'center') === 'center'
    this.orgId = this.db.getSetting('yunxiao.organizationId')
    if (this.central && !this.orgId) {
      this.user = await this.request('/oapi/v1/platform/user')
      this.orgId = this.user?.lastOrganization ?? null
      if (this.orgId) this.db.setSetting('yunxiao.organizationId', this.orgId)
    }
  }

  orgPath(service, path = '') {
    return this.central
      ? `/oapi/v1/${service}/organizations/${this.orgId}${path}`
      : `/oapi/v1/${service}${path}`
  }

  async request(path, { method = 'GET', query, body, timeoutMs = 20_000 } = {}) {
    await this.ensureReady()
    const url = new URL(path, this.base)
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v))
    const { status, data } = await httpsJson(url.toString(), {
      method,
      headers: {
        'x-yunxiao-token': this.token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs,
    })
    if (!(status >= 200 && status < 300)) {
      const e = new Error(`yunxiao ${status} ${url.pathname}: ${typeof data === 'object' ? (data.errorMessage || data.errorCode) : String(data).slice(0, 160)}`)
      e.status = status
      e.code = status === 403 || data?.errorCode === 'Forbidden' ? 'yunxiao-permission-denied' : 'yunxiao-error'
      throw e
    }
    if (data && typeof data === 'object' && data.errorCode) {
      const e = new Error(`yunxiao: ${data.errorMessage || data.errorCode}`)
      e.code = data.errorCode === 'Forbidden' ? 'yunxiao-permission-denied' : 'yunxiao-error'
      throw e
    }
    return data
  }

  /* --------------------------- read capabilities -------------------------- */

  async getUser() {
    await this.ensureReady()
    return this.request('/oapi/v1/platform/user')
  }

  /** Codeup repositories. Returns raw rows. */
  async listRepositories({ page = 1, pageSize = 50 } = {}) {
    await this.ensureReady()
    return this.request(this.orgPath('codeup', '/repositories'), { query: { page, pageSize } })
  }

  /** Projex projects (POST search). Returns raw rows. */
  async searchProjects({ page = 1, pageSize = 50 } = {}) {
    await this.ensureReady()
    return this.request(this.orgPath('projex', '/projects:search'), {
      method: 'POST',
      body: { page, pageSize },
    })
  }

  /** Flow pipelines. Returns raw rows. */
  async listPipelines({ page = 1, pageSize = 50 } = {}) {
    await this.ensureReady()
    return this.request(this.orgPath('flow', '/pipelines'), { query: { page, pageSize } })
  }

  /** Projex workitems (Req/Task/Bug). Returns raw rows. */
  async searchWorkitems({ category, spaceId, page = 1, perPage = 20, orderBy = 'gmtModified', sort = 'desc' } = {}) {
    await this.ensureReady()
    return this.request(this.orgPath('projex', '/workitems:search'), {
      method: 'POST',
      body: { category, spaceId, page, perPage, orderBy, sort },
    })
  }

  /** Codeup commits of one repository branch. refName is required. */
  async listCommits({ repositoryId, refName, since, until, page = 1, pageSize = 50 } = {}) {
    await this.ensureReady()
    return this.request(this.orgPath('codeup', `/repositories/${encodeURIComponent(String(repositoryId))}/commits`), {
      query: {
        refName: refName ?? 'master',
        page,
        pageSize,
        ...(since ? { since } : {}),
        ...(until ? { until } : {}),
      },
    })
  }

  /** Run one pipeline. Returns the new runId (number). WRITE operation. */
  async runPipeline(pipelineId) {
    await this.ensureReady()
    return this.request(this.orgPath('flow', `/pipelines/${encodeURIComponent(String(pipelineId))}/runs`), {
      method: 'POST',
      body: {},
    })
  }

  /** Latest run info of one pipeline. */
  async getLatestPipelineRun(pipelineId) {
    await this.ensureReady()
    return this.request(this.orgPath('flow', `/pipelines/${encodeURIComponent(String(pipelineId))}/runs/latestPipelineRun`))
  }

  /** Personal effort records (报工) in a [startDate, endDate] window. */
  async listEffortRecords({ startDate, endDate } = {}) {
    await this.ensureReady()
    return this.request(this.orgPath('projex', '/effortRecords'), { query: { startDate, endDate } })
  }

  /** Appstack apps (needs extra PAT permission). */
  async listApps({ page = 1, pageSize = 50 } = {}) {
    await this.ensureReady()
    return this.request(this.orgPath('appstack', '/apps'), { method: 'POST', body: { page, pageSize } })
  }
}
