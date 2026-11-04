/**
 * 打包 antd 表单组件到 client.js（单文件内嵌，插件无构建期的发布形态约束）。
 * - 产物以 CJS 工厂形态内嵌：window.__WH_ANTD_BUNDLE__(require)，react / react-dom / react/jsx-runtime
 *   保持 external，由 DSH ModuleLoader 的 require 提供（静态注册表里有这三个模块）。
 * - client.js 运行时懒初始化：真 React 环境才执行；React 桩环境（tests/*）自动回退原生控件。
 * 用法：node scripts/build-antd.mjs [--check]（--check 仅校验 client.js 已包含产物，CI 用）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const clientPath = path.join(root, 'client.js')
const START = '/* __WH_ANTD_VENDOR_START__ */'
const END = '/* __WH_ANTD_VENDOR_END__ */'

const entry = `
export { Button, Input, Select, Form, Switch, Checkbox, Radio, DatePicker, TimePicker, InputNumber,
  Space, Divider, Row, Col, Segmented, Tooltip, Popconfirm, ConfigProvider, Tag, Alert, Spin, App as AntApp, theme } from 'antd'
export { default as zhCN } from 'antd/locale/zh_CN'
export { default as dayjs } from 'dayjs'
`

async function main() {
  const checkOnly = process.argv.includes('--check')
  const client = fs.readFileSync(clientPath, 'utf8')
  if (checkOnly) {
    if (!client.includes(START) || !client.includes(END) || client.indexOf(END) - client.indexOf(START) < 1000) {
      console.error('client.js 缺少 antd vendor 产物（先跑 node scripts/build-antd.mjs）')
      process.exit(1)
    }
    console.log('vendor 产物存在 ✓')
    return
  }

  const { build } = await import('esbuild')
  const tmpEntry = path.join(root, 'node_modules', '.wh-antd-entry.mjs')
  const tmpOut = path.join(root, 'node_modules', '.wh-antd-out.js')
  fs.writeFileSync(tmpEntry, entry)
  await build({
    entryPoints: [tmpEntry],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile: tmpOut,
    logLevel: 'warning',
  })
  const code = fs.readFileSync(tmpOut, 'utf8')
  const wrapped = `window.__WH_ANTD_BUNDLE__ = function (require) {
  var module = { exports: {} }
  var exports = module.exports
${code}
  return module.exports
}`
  const vendor = `${START}
${wrapped}
${END}`

  let next
  if (client.includes(START) && client.includes(END)) {
    const pre = client.slice(0, client.indexOf(START))
    const post = client.slice(client.indexOf(END) + END.length)
    next = pre + vendor + post
  } else {
    const anchor = 'async function api(path, init) {'
    next = client.replace(anchor, () => vendor + '\n\n' + anchor) // 函数形式：产物含 $& 等字符，不能用字符串替换模式
  }
  fs.writeFileSync(clientPath, next)
  const kb = Math.round(Buffer.byteLength(next) / 1024)
  console.log(`antd vendor 已内嵌 client.js（总 ${kb} KB，产物 ${Math.round(Buffer.byteLength(code) / 1024)} KB）`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
