/**
 * CredentialStore — OS-level secret storage for sensitive tokens (e.g. the
 * Yunxiao PAT). SQLite only ever holds a credentialRef, never the value.
 *
 * macOS: Keychain via the `security` CLI (verified in M0-v3: full
 * add/find/delete roundtrip). Other platforms: in-memory fallback with a
 * warning flag so the UI can tell the user the platform is unsupported.
 */
import { execFile } from 'node:child_process'
import os from 'node:os'

function run(args) {
  return new Promise((resolve, reject) => {
    execFile('security', args, { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim()))
      else resolve(stdout.trim())
    })
  })
}

export class CredentialStore {
  constructor(service = 'workhub') {
    this.service = service
    this.supported = process.platform === 'darwin'
  }

  async set(key, value) {
    if (!this.supported) throw new Error('credential store unsupported on this platform')
    // `-U` 自带 update 语义，无需先 delete（避免凭证瞬时缺失窗口）
    return run([
      'add-generic-password',
      '-s', this.service,
      '-a', key,
      '-w', String(value),
      '-U',
    ])
  }

  async get(key) {
    if (!this.supported) return null
    try {
      return await run(['find-generic-password', '-s', this.service, '-a', key, '-w'])
    } catch {
      return null
    }
  }

  async delete(key) {
    if (!this.supported) return
    try {
      await run(['delete-generic-password', '-s', this.service, '-a', key])
    } catch {}
  }
}
