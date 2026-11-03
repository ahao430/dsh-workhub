/**
 * 发布物料完整性检查：插件清单、files 声明、本地化文件、截图是否齐全。
 * 本地与 CI 均可运行：node tests/manifest-check.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const abs = (rel) => path.join(root, rel)
const problems = []

function readJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(abs(rel), 'utf8'))
  } catch (e) {
    problems.push(`${rel} 读取/解析失败: ${e.message}`)
    return null
  }
}
function mustExist(rel, what) {
  if (!rel.includes('*')) {
    if (!fs.existsSync(abs(rel))) problems.push(`${what} 不存在: ${rel}`)
    return
  }
  // files 里允许通配（如 docs/screens/*.png），至少要匹配到一个文件
  const dir = path.dirname(rel)
  const nameRe = new RegExp(`^${path.basename(rel).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  let matched = []
  try { matched = fs.readdirSync(abs(dir)).filter((f) => nameRe.test(f)) } catch { matched = [] }
  if (matched.length === 0) problems.push(`${what} 无匹配文件: ${rel}`)
}

const pkg = readJson('package.json')
if (pkg) {
  if (!pkg.name || !pkg.version) problems.push('package.json 缺少 name / version')
  if (!pkg.dsh?.bundle?.patch) problems.push('package.json 缺少 dsh.bundle.patch（插件市场无法识别）')
  if (pkg.dsh?.client?.platform !== 'web') problems.push('package.json 的 dsh.client.platform 应为 web')

  const files = pkg.files ?? []
  if (files.length === 0) problems.push('package.json 缺少 files 白名单')
  for (const f of files) mustExist(f, 'files 声明的文件')
  for (const required of ['index.js', 'client.js', 'cordis.patch.yml']) {
    if (!files.includes(required)) problems.push(`files 未包含 ${required}`)
  }
}

const patch = fs.existsSync(abs('cordis.patch.yml')) ? fs.readFileSync(abs('cordis.patch.yml'), 'utf8') : ''
if (patch && pkg?.name && !patch.includes(pkg.name)) {
  problems.push(`cordis.patch.yml 未引用包名 ${pkg.name}（插件加载会失败）`)
}

for (const f of fs.readdirSync(abs('locale'))) {
  const data = readJson(`locale/${f}`)
  if (data && !data.meta?.title) problems.push(`locale/${f} 缺少 meta.title`)
}

const shots = readJson('screenshots.json')?.screenshots ?? []
if (shots.length === 0) problems.push('screenshots.json 缺少截图列表')
for (const rel of shots) mustExist(rel, '市场截图')

if (problems.length) {
  console.error('物料检查失败：')
  for (const p of problems) console.error('  -', p)
  process.exit(1)
}
console.log(`物料检查通过：${pkg.name}@${pkg.version}，${(pkg.files ?? []).length} 项 files，${shots.length} 张截图`)
