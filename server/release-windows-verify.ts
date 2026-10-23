import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile, fork } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
const execute = promisify(execFile)
if (process.platform !== 'win32') throw new Error('Windows verification requires Windows')
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-runtime-verify-'))
try {
  const source = path.resolve(import.meta.dirname, '..')
  const cli = await import(pathToFileURL(path.join(source, 'apps/cli/src/runtime.mjs')).href)
  const version = JSON.parse(await fs.readFile(path.join(source, 'apps/cli/package.json'), 'utf8')).version
  const artifact = path.resolve(process.argv[2], `mew-runtime-win32-${process.arch}.tar.gz`)
  const runtime = await cli.prepareRuntime({ version, target: cli.runtimeTarget(), cacheDir: path.join(temporary, 'cache'), fetchImpl: async (url: string) => new Response(await fs.readFile(url.endsWith('SHA256SUMS') ? artifact + '.sha256' : artifact)) })
  const workspace = path.join(temporary, 'workspace'), data = path.join(temporary, 'data')
  await fs.mkdir(workspace)
  const env = { ...process.env, MEW_DATA_DIR: data, MEW_WORKSPACE: workspace, MEW_OWNER_EMAIL: 'owner@example.test', MEW_TEAM_PORT: '0', MEW_BIND: '127.0.0.1', MEW_DISTRIBUTION: 'release', MEW_MULTIPLEXER: path.join(runtime, 'bin/psmux.exe'), MEW_WINDOWS_PROCESS_HOST: path.join(runtime, 'native/windows/process-host.exe') }
  await execute(process.execPath, ['--test', 'server/platform.test.ts', 'server/windows-native.test.ts'], { cwd: source, env, timeout: 120_000, maxBuffer: 1024 * 1024 })
  // A fresh, isolated compiled host proves that imports, junctions, auth and dist agree.
  const child = fork(path.join(runtime, 'server/cli-host.js'), [], { cwd: workspace, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] })
  try {
    const ready = await new Promise<{ url: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Compiled Windows host startup timed out')), 30_000)
      child.on('message', (message: any) => {
        if (message.type === 'error') { clearTimeout(timer); reject(new Error(message.message)) }
        if (message.type === 'ready') { clearTimeout(timer); resolve(message) }
      })
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Compiled Windows host exited before readiness')) })
    })
    const response = await fetch(`${ready.url}/api/auth/me`)
    if (!response.ok) throw new Error('Compiled Windows authentication bootstrap failed')
    const html = await fetch(ready.url)
    if (!html.ok || !(await html.text()).includes('<html')) throw new Error('Compiled Windows UI assets failed')
  } finally {
    child.disconnect()
    await new Promise<void>(resolve => { const kill = setTimeout(() => child.kill(), 4000); child.once('exit', () => { clearTimeout(kill); resolve() }) })
  }
} finally { await fs.rm(temporary, { recursive: true, force: true }) }
