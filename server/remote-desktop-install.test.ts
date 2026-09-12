import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import express from 'express'
import { createDesktopInstaller, DESKTOP_INSTALL_SESSION } from './remote-desktop-install.ts'
import { createRemoteDesktopRoutes } from './remote-desktop.ts'
import { installDesktopHelper } from '../native/remote-desktop/install.mjs'
import type { RequestAuth } from './reqAuth.ts'

const exec = promisify(execFile)
async function fixture() {
  // Shell metacharacters in a legitimate installation path must stay literal.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mew desktop's $(false)-"))
  const directory = path.join(root, 'state'), appRoot = path.join(root, 'app')
  await fs.mkdir(path.join(appRoot, 'native/remote-desktop'), { recursive: true })
  const entry = path.join(appRoot, 'native/remote-desktop/install.mjs')
  await fs.writeFile(entry, 'console.log("fixture only"); process.exitCode = 7')
  let alive = false, command = '', runs = 0, kills = 0
  const tmux = {
    async list() { return alive ? [{ name: DESKTOP_INSTALL_SESSION, createdAt: 0, windows: 1, attached: false }] : [] },
    async kill(name: string) { assert.equal(name, DESKTOP_INSTALL_SESSION); alive = false; kills++ },
    async runCommand(name: string, value: string, cwd: string) { assert.equal(name, DESKTOP_INSTALL_SESSION); assert.equal(cwd, appRoot); command = value; alive = true; runs++ },
  }
  const options = { directory, appRoot, platform: 'wsl' as const, env: { PATH: process.env.PATH, WSL_INTEROP: '/fixture/socket' } }
  const installer = createDesktopInstaller(tmux, options)
  return { root, entry, directory, appRoot, installer, tmux, options, get runs() { return runs }, get kills() { return kills }, execute: () => exec('/bin/sh', ['-c', command], { cwd: appRoot }), remove: () => fs.rm(root, { recursive: true, force: true }) }
}

test('fixed tmux installer deduplicates starts, preserves failure output and survives server recreation', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.installer.status()).state, 'idle')
    const jobs = await Promise.all([f.installer.start(), f.installer.start(), f.installer.start()])
    assert.equal(f.runs, 1); assert.ok(jobs.every(job => job.state === 'running'))
    await assert.rejects(f.execute(), (error: Error & { code: number; stdout: string }) => error.code === 7 && error.stdout.includes('fixture only'))
    assert.deepEqual(await f.installer.status(), { session: DESKTOP_INSTALL_SESSION, terminal: true, state: 'failed', exitCode: 7 })
    assert.equal(f.kills, 0, 'completed output remains in tmux')
    const restored = createDesktopInstaller(f.tmux, f.options)
    assert.equal((await restored.status()).state, 'failed')
    await fs.writeFile(f.entry, 'console.log(process.env.WSL_INTEROP); console.log(process.env.MEW_DESKTOP_HELPER_DIR ?? "unset")')
    await restored.start()
    assert.equal(f.runs, 2); assert.equal(f.kills, 1)
    const result = await f.execute()
    assert.match(result.stdout, /\/fixture\/socket\nunset/)
    assert.equal((await restored.status()).state, 'succeeded')
    assert.equal((await fs.stat(path.join(f.directory, 'exit-code'))).mode & 0o777, 0o600)
    await restored.start(); await f.tmux.kill(DESKTOP_INSTALL_SESSION)
    assert.equal((await restored.status()).state, 'interrupted')
  } finally { await f.remove() }
})

test('install endpoints require a privileged role and ignore submitted commands/paths', async () => {
  const f = await fixture()
  let auth: RequestAuth = { role: 'guest', email: null, mustChangePassword: false }
  const app = express()
  app.use(express.json(), (req, _res, next) => { req.auth = auth; next() })
  app.use('/remote-desktop', createRemoteDesktopRoutes(f.tmux, f.installer))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/remote-desktop/install`
  try {
    assert.equal((await fetch(url)).status, 403)
    auth = { ...auth, role: 'member', email: 'fixture@example.test' }
    assert.equal((await fetch(url, { method: 'POST' })).status, 403)
    assert.equal(f.runs, 0)
    auth.role = 'manager'
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'touch /never-run', cwd: '/', session: 'other-session' }) })
    assert.equal(response.status, 200)
    assert.equal((await response.json() as { session: string }).session, DESKTOP_INSTALL_SESSION)
    assert.equal(f.runs, 1)
    auth.role = 'owner'
    assert.equal((await (await fetch(url)).json() as { state: string }).state, 'running')
    await fetch(url, { method: 'POST' }); assert.equal(f.runs, 1)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await f.remove() }
})

test('WSL installer uses Windows PowerShell and target, reports missing interop and forwards npm failure', () => {
  const calls: { command: string; args: string[] }[] = []
  const run = (command: string, args: string[]) => { calls.push({ command, args }); return { status: command === 'wslpath' ? 0 : 19, stdout: '\\\\wsl.localhost\\Ubuntu\\home\\fixture\\install.ps1\n' } }
  const target = "C:\\Users\\Test User\\Mew's helper"
  assert.equal(installDesktopHelper({ platform: 'linux', release: 'microsoft', env: { MEW_DESKTOP_HELPER_DIR: target }, run }), 19)
  assert.equal(calls[1].command, 'powershell.exe')
  assert.ok(calls[1].args.includes('-File'))
  assert.deepEqual(calls[1].args.slice(-2), ['-Target', target])
  assert.throws(() => installDesktopHelper({ platform: 'linux', release: 'microsoft', env: { MEW_DESKTOP_HELPER_DIR: '/home/helper' }, run }), /Windows/)
  assert.throws(() => installDesktopHelper({ platform: 'linux', release: 'microsoft', env: {}, run: () => ({ status: 1 }) }), /interop/)
})

test('Mac/Linux helper override receives the complete helper before npm ci', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-helper-target-'))
  try {
    for (const platform of ['darwin', 'linux']) {
      const target = path.join(directory, platform)
      let invoked = false
      const result = installDesktopHelper({ platform, release: '', env: { MEW_DESKTOP_HELPER_DIR: target }, run: (command: string, args: string[]) => {
        assert.equal(command, 'npm'); assert.deepEqual(args, ['ci', '--prefix', target, '--omit=dev', '--no-audit', '--no-fund']); invoked = true; return { status: 0 }
      } })
      assert.equal(result, 0); assert.equal(invoked, true)
      assert.match(await fs.readFile(path.join(target, 'main.mjs'), 'utf8'), /electron/)
      assert.ok(await fs.stat(path.join(target, 'package-lock.json')))
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
