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
      let received = 0
      res.on('data', (c) => {
        chunks.push(c)
        received += c.length
        // 带 error 的 destroy 保证 reject 一定触发（裸 destroy 不触发 req error，Promise 会悬挂）
        if (received > 8 * 1024 * 1024) req.destroy(new Error('yunxiao response too large'))
      })
      res.on('error', reject)
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
    this._ready = null
  }

  /** 并发安全：多个调用同时进入时共享同一个初始化 Promise，
   *  避免 base 已赋值而 central/orgId 尚未就绪时拼出缺组织段的路径。
   *  初始化失败时重置缓存：瞬时网络错误不会让实例后续所有请求复用同一个 rejected promise。 */
  ensureReady() {
    this._ready ??= this._init().catch((e) => { this._ready = null; throw e })
    return this._ready
  }

  async _init() {
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
      // 注意：这里不能走 this.request()（它会再次 await ensureReady() → 等待本函数自身，死锁），
      // 直接用底层 httpsJson 引导组织 ID。
      const url = new URL('/oapi/v1/platform/user', this.base)
      const { status, data } = await httpsJson(url.toString(), { headers: { 'x-yunxiao-token': this.token } })
      if (!(status >= 200 && status < 300)) throw new Error(`yunxiao bootstrap ${status}: 无法获取组织 ID`)
      this.user = data
      this.orgId = data?.lastOrganization ?? null
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

  /* ------------------------- appstack（应用交付） ------------------------ */
  // 官方文档：https://help.aliyun.com/zh/yunxiao/developer-reference/listapplications
  // PAT 需要「应用交付」权限：应用/环境/部署单/应用编排（部署需读写）。

  /** Appstack applications（keyset 分页，聚合到单数组）。 */
  async listApps({ perPage = 50, max = 200 } = {}) {
    await this.ensureReady()
    const rows = []
    let nextToken
    do {
      const page = await this.request(this.orgPath('appstack', '/apps:search'), {
        query: { pagination: 'keyset', perPage, orderBy: 'id', sort: 'desc', nextToken },
      })
      rows.push(...(page?.data ?? []))
      nextToken = page?.nextToken ?? null
    } while (nextToken && rows.length < max)
    return rows
  }

  /** Environments of one app（含运行状态 RUNNING/DEPLOYING/ERROR/NEW）。 */
  async listAppEnvironments(appName, { perPage = 30 } = {}) {
    await this.ensureReady()
    const page = await this.request(this.orgPath('appstack', `/apps/${encodeURIComponent(appName)}/envs`), {
      query: { pagination: 'keyset', perPage, orderBy: 'id', sort: 'desc' },
    })
    return page?.data ?? []
  }

  /** 应用研发流程列表（多环境部署阶段：envType 标签 + 每阶段绑定的 Flow 流水线）。 */
  async listReleaseWorkflows(appName) {
    await this.ensureReady()
    return this.request(this.orgPath('appstack', `/apps/${encodeURIComponent(appName)}/releaseWorkflows`), {})
  }

  /** Flow 流水线最近运行列表（研发阶段运行进度跟踪）。 */
  async listPipelineRuns(pipelineId, { pageSize = 5 } = {}) {
    await this.ensureReady()
    const id = parseInt(pipelineId, 10)
    if (!Number.isFinite(id) || id <= 0) throw Object.assign(new Error('invalid pipelineId'), { code: 'bad-request' })
    return this.request(this.orgPath('flow', `/pipelines/${id}/runs`), { query: { page: 1, pageSize } })
  }

  /** 执行研发阶段流水线（运行研发流程阶段，params 支持指定分支与运行变量）。 */
  async executeReleaseStage(appName, workflowSn, stageSn, { params } = {}) {
    await this.ensureReady()
    return this.request(this.orgPath('appstack', `/apps/${encodeURIComponent(appName)}/releaseWorkflows/${encodeURIComponent(workflowSn)}/releaseStages/${encodeURIComponent(stageSn)}:execute`), {
      method: 'POST',
      body: { params: params ?? {} },
    })
  }

  /** Recent change orders（部署单）of one app；页码分页，pageSize ≤ 30。 */
  async listChangeOrders(appName, { current = 1, pageSize = 10 } = {}) {
    await this.ensureReady()
    const page = await this.request(this.orgPath('appstack', `/apps/${encodeURIComponent(appName)}/changeOrders/api`), {
      method: 'POST', query: { current, pageSize }, body: {},
    })
    return page?.records ?? []
  }

  /** Latest KUBERNETES orchestration revision of an app（部署单必填 sha）。 */
  async getLatestOrchestration(appName) {
    await this.ensureReady()
    const orch = await this.request(
      this.orgPath('appstack', `/apps/${encodeURIComponent(appName)}/orchestrations/${encodeURIComponent(`${appName}@KUBERNETES`)}`),
    )
    return { sha: orch?.revision?.sha ?? null, message: orch?.revision?.message ?? '', commitTime: orch?.revision?.commitTime ?? '' }
  }

  /** Create a change order（真实触发部署，调用方必须先获得用户确认）。 */
  async createChangeOrder(appName, body) {
    await this.ensureReady()
    return this.request(this.orgPath('appstack', `/apps/${encodeURIComponent(appName)}/changeOrders`), { method: 'POST', body })
  }
}
