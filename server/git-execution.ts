import { WORKSPACE_ROOT } from './paths.ts'
import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import simpleGit from 'simple-git'
import { GitConnectionError, gitConnections, gitIdentityEnv, type GitConnection } from './git-connections.ts'
import { gitProvider, gitProviders } from './git-providers.ts'

export const gitRequestContext = new AsyncLocalStorage<{ owner: string | null; workspace?: string; connection?: GitConnection }>()

/** Only registered hosts; a remote cannot turn the credential service into an arbitrary proxy. */
export function providerRemote(input: string): { provider: string; host: string; url: string; path: string } {
  const ssh = /^(?:git@)([^:]+):(.+)$/.exec(input)
  let url: URL
  try { url = new URL(ssh ? `https://${ssh[1]}/${ssh[2]}` : input) } catch { throw new GitConnectionError('지원하는 Git 제공자의 원격 주소를 설정하세요.', 400, 'git-provider-unsupported') }
  if (url.protocol === 'ssh:' && url.username === 'git' && !url.password && !url.port) { url = new URL(`https://${url.hostname}${url.pathname}`) }
  const provider = gitProviders.find(item => item.host === url.hostname)
  if (!provider || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !provider.acceptsPath(url.pathname)) throw new GitConnectionError('지원하는 제공자의 HTTPS 또는 SSH 저장소 주소를 사용하세요.', 400, 'git-provider-unsupported')
  return { provider: provider.id, host: provider.host, url: url.toString(), path: url.pathname.slice(1) }
}

export async function requireGitConnection(cwd: string, owner = gitRequestContext.getStore()?.owner): Promise<GitConnection> {
  if (!owner) throw new GitConnectionError('Mew에 로그인하세요.', 403, 'forbidden')
  const git = simpleGit(cwd)
  const branch = (await git.raw(['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '')).trim()
  const configured = branch ? (await git.getConfig(`branch.${branch}.remote`)).value : null
  const remotes = await git.getRemotes()
  const name = configured && configured !== '.' ? configured : remotes.some(remote => remote.name === 'origin') ? 'origin' : remotes.length === 1 ? remotes[0].name : null
  if (remotes.length && !name) throw new GitConnectionError('커밋에 사용할 원격 추적 브랜치를 설정하세요.', 400, 'git-remote-ambiguous')
  const target = name ? providerRemote((await git.remote(['get-url', name]))!.trim()) : { provider: 'github', host: 'github.com' }
  const context = gitRequestContext.getStore()
  if (context?.workspace && context.workspace !== WORKSPACE_ROOT) throw new GitConnectionError('프로젝트가 변경되었습니다. 다시 실행하세요.', 409, 'git-workspace-changed')
  await gitConnections.resolve(owner, target.provider, target.host, gitProvider(target.provider, target.host).refresh)
  const record = gitConnections.require(owner, target.provider, target.host)
  if (context && context.owner === owner) context.connection = record
  return record
}

export function currentGitEnv() { return gitIdentityEnv(gitRequestContext.getStore()?.connection?.identity) }

/** A one-operation credential socket: neither URL, argv, nor environment contains the token. */
export async function withGitCredential<T>(connection: GitConnection, target: ReturnType<typeof providerRemote>, run: (env: NodeJS.ProcessEnv, config: string[]) => Promise<T>): Promise<T> {
  if (connection.provider !== target.provider || connection.host !== target.host) throw new GitConnectionError('이 저장소에 사용할 Git 계정을 연결하세요.')
  await gitProvider(connection.provider, connection.host).identify(connection.accessToken)
  const owner = gitRequestContext.getStore()?.owner
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-git-auth-'))
  const socket = path.join(directory, 'credential.sock')
  const clients = new Set<net.Socket>()
  const server = net.createServer(client => {
    clients.add(client); client.on('close', () => clients.delete(client)); client.on('error', () => {})
    client.setTimeout(5000, () => client.destroy())
    let input = ''
    client.on('data', data => {
      input += data.toString()
      if (input.length > 8192) { client.destroy(); return }
      if (!input.includes('\n')) return
      try {
        const request = JSON.parse(input.split('\n')[0])
        if (owner) gitConnections.require(owner, connection.provider, connection.host, connection.id)
        if (request.protocol !== 'https' || request.host !== target.host || request.path !== target.path) { client.end('{}\n'); return }
        client.end(JSON.stringify({ username: gitProvider(connection.provider, connection.host).gitUsername, password: connection.accessToken }) + '\n')
      } catch { client.end('{}\n') }
    })
  })
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => { server.removeListener('error', reject); resolve() }) })
    fs.chmodSync(socket, 0o600)
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
    const helper = `!${quote(process.execPath)} ${quote(fileURLToPath(new URL('./git-credential-helper.cjs', import.meta.url)))}`
    const env = { ...gitIdentityEnv(connection.identity), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', MEW_GIT_CREDENTIAL_SOCKET: socket }
    for (const key of Object.keys(env)) if (/^(GIT_TRACE|GIT_CURL_VERBOSE)/.test(key)) delete (env as NodeJS.ProcessEnv)[key]
    return await run(env, ['credential.helper=', `credential.helper=${helper}`, 'credential.useHttpPath=true', 'http.extraHeader=', 'http.cookieFile=', 'http.saveCookies=false', 'http.followRedirects=false', 'http.sslVerify=true', 'protocol.allow=never', 'protocol.https.allow=always'])
  } finally {
    clients.forEach(client => client.destroy())
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
