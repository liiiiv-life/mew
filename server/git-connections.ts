import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto'
import { DATA_DIR, writeFileAtomic } from './dataDir.ts'

export interface GitIdentity { name: string; email: string }
export interface GitConnection {
  id: string; provider: string; host: string; login: string; identity: GitIdentity
  accessToken: string; expiresAt?: number; refreshToken?: string; refreshExpiresAt?: number
}
export class GitConnectionError extends Error {
  status: number
  code: string
  constructor(message: string, status = 428, code = 'git-auth-required') { super(message); this.status = status; this.code = code }
}

/** Application isolation, not an OS sandbox. Never return these records through an API. */
export class GitConnections {
  private root: string
  private refreshing = new Map<string, Promise<GitConnection | null>>()
  constructor(root = path.join(DATA_DIR, 'git-connections')) { this.root = root }
  private file(owner: string, provider: string, host: string) {
    if (!owner) throw new GitConnectionError('Mew에 로그인하세요.', 403, 'forbidden')
    return path.join(this.root, createHash('sha256').update(JSON.stringify([owner, provider, host])).digest('hex') + '.json')
  }
  private key(create: boolean): Buffer {
    const file = path.join(this.root, 'key')
    if (create) {
      fs.mkdirSync(this.root, { recursive: true, mode: 0o700 })
      try { fs.writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    const key = fs.readFileSync(file)
    if (key.length !== 32) throw new Error('Git 연결 암호화 키를 확인하세요.')
    return key
  }
  get(owner: string, provider = 'github', host = 'github.com'): GitConnection | null {
    const file = this.file(owner, provider, host)
    let raw: string
    try { raw = fs.readFileSync(file, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    try {
      const value = JSON.parse(raw)
      const decipher = createDecipheriv('aes-256-gcm', this.key(false), Buffer.from(value.iv, 'base64'))
      decipher.setAAD(Buffer.from(JSON.stringify([owner, provider, host])))
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
      const record = JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString()) as GitConnection
      if (record.provider !== provider || record.host !== host || !record.accessToken || !record.identity?.email || !record.id) throw new Error()
      return record
    } catch { throw new GitConnectionError('Git 연결 정보를 읽지 못했습니다. 연결을 해제하고 다시 로그인하세요.', 503, 'git-connection-storage') }
  }
  require(owner: string, provider = 'github', host = 'github.com', id?: string): GitConnection {
    const record = this.get(owner, provider, host)
    if (!record || (record.expiresAt && record.expiresAt <= Date.now()) || (id && record.id !== id)) throw new GitConnectionError('Git 계정을 연결한 뒤 다시 시도하세요.')
    return record
  }
  async resolve(owner: string, provider: string, host: string, refresh?: (token: string) => Promise<Pick<GitConnection, 'accessToken' | 'expiresAt' | 'refreshToken' | 'refreshExpiresAt'>>): Promise<GitConnection | null> {
    const record = this.get(owner, provider, host)
    if (!record?.expiresAt || record.expiresAt > Date.now()) return record
    if (!record.refreshToken || !refresh || (record.refreshExpiresAt && record.refreshExpiresAt <= Date.now())) return null
    const file = this.file(owner, provider, host)
    const pending = this.refreshing.get(file)
    if (pending) return pending
    const task = (async () => {
      try {
        const token = await refresh(record.refreshToken!)
        const current = this.get(owner, provider, host)
        if (current?.id !== record.id) return current
        return this.write(owner, { ...record, ...token, expiresAt: token.expiresAt, refreshToken: token.refreshToken, refreshExpiresAt: token.refreshExpiresAt })
      } catch (error) {
        if (error instanceof GitConnectionError && error.code === 'git-auth-required') return null
        throw error
      }
    })()
    this.refreshing.set(file, task)
    try { return await task } finally { this.refreshing.delete(file) }
  }
  set(owner: string, value: Omit<GitConnection, 'id'>): GitConnection {
    return this.write(owner, { ...value, id: randomUUID() })
  }
  private write(owner: string, record: GitConnection): GitConnection {
    const file = this.file(owner, record.provider, record.host)
    const key = this.key(true), iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(JSON.stringify([owner, record.provider, record.host])))
    const data = Buffer.concat([cipher.update(JSON.stringify(record)), cipher.final()])
    writeFileAtomic(file, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }))
    return record
  }
  remove(owner: string, provider = 'github', host = 'github.com') { fs.rmSync(this.file(owner, provider, host), { force: true }) }
}
export const gitConnections = new GitConnections()

export function gitIdentityEnv(identity?: GitIdentity): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.GIT_PAGER
  delete env.PAGER
  delete env.GIT_SSL_NO_VERIFY
  for (const key of Object.keys(env)) if (/^(GIT_(AUTHOR|COMMITTER)_|GH_TOKEN$|GITHUB_TOKEN$|GIT_CONFIG_|GIT_ASKPASS$|SSH_ASKPASS$)/.test(key)) delete env[key]
  if (identity) Object.assign(env, { GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email, GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email })
  return env
}
