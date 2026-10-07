import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { DATA_DIR } from './dataDir.ts'
import { listUsers, normalizeEmail } from './auth.ts'
import { workspaceContext } from './paths.ts'

const accountContext = new AsyncLocalStorage<string | null>()
export const AGENT_ACCOUNT_ENV = 'MEW_AGENT_ACCOUNT'
const files = ['agent-guidance.md', 'agent-guidance.txt', 'agent-defaults.json', 'agent-settings.json'] as const
export type AgentSettingsFile = typeof files[number]

/** Request identity wins over inherited supervisor environment, including anonymous requests. */
export function agentSettingsAccount(): string | null {
  const account = accountContext.getStore()
  if (account !== undefined) return account
  const request = workspaceContext.getStore()
  return request ? request.account : process.env[AGENT_ACCOUNT_ENV] || null
}

export function runWithAgentAccount<T>(account: string | null, action: () => T): T {
  return accountContext.run(account ? normalizeEmail(account) : null, action)
}

export function agentSettingsEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base }
  const account = agentSettingsAccount()
  if (account) env[AGENT_ACCOUNT_ENV] = normalizeEmail(account)
  else delete env[AGENT_ACCOUNT_ENV]
  return env
}

/** Publish the entire initial account snapshot once; never import again after reset/deletion. */
export function agentSettingsPath(file: AgentSettingsFile, account = agentSettingsAccount()): string {
  if (!account) return path.join(DATA_DIR, file)
  const email = normalizeEmail(account)
  const root = path.join(DATA_DIR, 'agent-accounts')
  const directory = path.join(root, createHash('sha256').update(email).digest('hex'))
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 })
    const temporary = fs.mkdtempSync(path.join(root, '.seed-'))
    try {
      const owner = listUsers().filter(user => user.record.role === 'owner')
        .sort((a, b) => a.record.createdAt - b.record.createdAt || a.email.localeCompare(b.email))[0]?.email
      const claim = path.join(root, '.legacy-owner')
      if (email === owner) {
        try { fs.writeFileSync(claim, email, { flag: 'wx', mode: 0o600 }) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      }
      const inheritedOwner = fs.existsSync(claim) ? fs.readFileSync(claim, 'utf8') : null
      if (email === owner && email === inheritedOwner) {
        for (const name of files) {
          try { fs.writeFileSync(path.join(temporary, name), fs.readFileSync(path.join(DATA_DIR, name)), { mode: 0o600 }) }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        }
      }
      fs.writeFileSync(path.join(temporary, '.initialized'), '', { mode: 0o600 })
      try { fs.renameSync(temporary, directory) }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
    } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
  }
  return path.join(directory, file)
}
