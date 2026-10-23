import type { IncomingMessage } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DATA_DIR } from './dataDir.ts'

export function requestIp(req: IncomingMessage): string {
  const address = req.socket.remoteAddress ?? 'unknown'
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) {
    const forwarded = req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim().replace(/^::ffff:/, '')
  }
  return address.replace(/^::ffff:/, '')
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const recordPath = (file: string) => path.join(DATA_DIR, 'change-ip', `${digest(path.resolve(file))}.json`)
export function recordChangeIp(file: string, ip: string, content: string): void {
  const target = recordPath(file)
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
    const temporary = `${target}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify({ ip, hash: digest(content) }), { mode: 0o600 })
    fs.renameSync(temporary, target)
  } catch { /* Attribution must not turn a successful save into an error. */ }
}
export function changedFromIp(file: string, ip: string): boolean {
  if (ip === 'unknown') return false
  try {
    const record = JSON.parse(fs.readFileSync(recordPath(file), 'utf8'))
    return record.ip === ip && record.hash === digest(fs.readFileSync(file))
  } catch { return false }
}
