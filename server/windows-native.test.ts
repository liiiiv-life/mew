import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { spawnHostProcess, stopProcessGroup, execHostFile } from './platform/process.ts'

const enabled = process.platform === 'win32' && process.env.MEW_TEST_WINDOWS_NATIVE === '1'
const execute = promisify(execFile)
test('Windows job host preserves Unicode and literal argv and contains detached descendants', { skip: !enabled }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-win-job-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const args = ['한글😀', 'a & b | % ^ !', 'a"b', 'C:\\trailing\\', "O'Brien"]
  const result = await execHostFile(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...args], { timeout: 5000 })
  assert.deepEqual(JSON.parse(result.stdout), args)
  const script = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}); console.log(JSON.stringify({parent:process.pid,child:c.pid})); setInterval(()=>{},1000)`
  const child = spawnHostProcess(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
  const data = await once(child.stdout!, 'data')
  const pids = JSON.parse(data[0].toString())
  const closed = once(child, 'close')
  child.kill('SIGKILL'); await closed
  for (const pid of [pids.parent, pids.child]) {
    let alive = true
    for (let i = 0; i < 50; i++) {
      try { process.kill(pid, 0) } catch { alive = false; break }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    if (alive) stopProcessGroup(pid)
    assert.equal(alive, false)
  }
})

test('Windows npm cmd shims preserve shell metacharacters as arguments', { skip: !enabled }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew win shim '))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const bin = path.join(directory, 'node_modules', '.bin')
  fs.mkdirSync(bin, { recursive: true })
  const report = path.join(directory, 'node_modules', 'report.js')
  fs.writeFileSync(report, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
  const shim = path.join(bin, 'fixture.cmd')
  fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "%~dp0\\..\\report.js" %*\r\n`)
  const args = ['한글😀', 'a & b | % ^ !', 'a"b', 'C:\\trailing\\']
  const result = await execHostFile(shim, args, { timeout: 5000 })
  assert.deepEqual(JSON.parse(result.stdout), args)
})

test('Windows job owner stops its child when the non-detached parent abruptly exits', { skip: !enabled, timeout: 15000 }, async t => {
  const fixture = fileURLToPath(new URL('./platform/process.ts', import.meta.url))
  const script = `import {spawnHostProcess} from ${JSON.stringify(pathToFileURL(fixture).href)}; const c=spawnHostProcess(process.execPath,['-e','console.log(process.pid); setInterval(()=>{},1000)'],{stdio:['ignore','pipe','ignore']}); c.stdout.on('data',d=>process.stdout.write(d)); setInterval(()=>{},1000)`
  const parent = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => { if (parent.exitCode === null) parent.kill('SIGKILL') })
  const pid = Number((await once(parent.stdout!, 'data'))[0].toString().trim())
  const closed = once(parent, 'close'); parent.kill('SIGKILL'); await closed
  let alive = true
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0) } catch { alive = false; break }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  if (alive) stopProcessGroup(pid)
  assert.equal(alive, false)
})

test('Windows psmux persists, accepts terminal input, captures Unicode and attaches through ConPTY', { skip: !enabled, timeout: 45000 }, async t => {
  const previous = process.env.MEW_MULTIPLEXER_NAMESPACE
  process.env.MEW_MULTIPLEXER_NAMESPACE = `mew-fixture-${randomUUID()}`
  const { terminalBackend } = await import('../packages/tmux-term/src/server/backends/index.ts')
  const { createTmuxManager } = await import('../packages/tmux-term/src/server/tmux.ts')
  const pty = await import('node-pty')
  const manager = createTmuxManager({ cwd: os.tmpdir() })
  t.after(async () => {
    await execute(terminalBackend.binary, terminalBackend.controlArgs(['kill-server'])).catch(() => {})
    if (previous === undefined) delete process.env.MEW_MULTIPLEXER_NAMESPACE; else process.env.MEW_MULTIPLEXER_NAMESPACE = previous
  })
  await manager.create('fixture')
  await manager.sendInput('fixture', "[Console]::WriteLine('fixture 한글😀 ready')")
  let capture = ''
  for (let i = 0; i < 100; i++) {
    capture = await manager.capture('fixture')
    if (capture.includes('fixture 한글😀 ready')) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(capture.includes('fixture 한글😀 ready'))
  assert.ok((await manager.list()).some(session => session.name === 'fixture'))
  const terminal = pty.spawn(terminalBackend.binary, terminalBackend.controlArgs(['attach-session', '-t', 'fixture']), { cols: 80, rows: 24, cwd: os.tmpdir(), env: process.env as Record<string, string> })
  t.after(() => { try { terminal.kill() } catch { /* closed */ } })
  let data = ''; terminal.onData(chunk => { data += chunk })
  terminal.resize(100, 30)
  terminal.write("[Console]::WriteLine('attached fixture')\r")
  for (let i = 0; i < 100 && !data.includes('attached fixture'); i++) await new Promise(resolve => setTimeout(resolve, 100))
  assert.ok(data.includes('attached fixture'))
})

test('Windows command runner archives final output, explicit exit, and cancellation', { skip: !enabled, timeout: 45000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-win-runner-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const runner = fileURLToPath(new URL('./agent-command-runner.ts', import.meta.url))
  async function run(command: string, cancel = false) {
    const directory = path.join(root, randomUUID()); fs.mkdirSync(directory)
    fs.writeFileSync(path.join(directory, 'record.json'), JSON.stringify({ command, cwd: root, session: 'fixture-absent', state: 'running' }))
    const child = spawnHostProcess(process.execPath, [runner, directory], { stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = once(child, 'close'); child.stdout!.resume(); child.stderr!.resume()
    t.after(() => { if (child.exitCode === null && child.pid) stopProcessGroup(child.pid) })
    if (cancel) {
      for (let i = 0; i < 100 && !fs.existsSync(path.join(directory, 'started')); i++) await new Promise(resolve => setTimeout(resolve, 50))
      assert.ok(fs.existsSync(path.join(directory, 'started')))
      fs.writeFileSync(path.join(directory, 'stop'), '')
    }
    await exited
    return { record: JSON.parse(fs.readFileSync(path.join(directory, 'record.json'), 'utf8')), output: gunzipSync(fs.readFileSync(path.join(directory, 'output.gz'))).toString('utf8') }
  }
  const result = await run("1..2000 | ForEach-Object { [Console]::WriteLine('한글😀 fixture '+$_) }; [Console]::WriteLine('final fixture'); exit 23")
  assert.equal(result.record.state, 'failed'); assert.equal(result.record.exitCode, 23)
  assert.ok(result.output.includes('한글😀 fixture 2000')); assert.ok(result.output.includes('final fixture'))
  const cancelled = await run("[IO.File]::WriteAllText((Join-Path (Get-Location) 'started'),''); while($true){Start-Sleep -Milliseconds 100}", true)
  assert.equal(cancelled.record.state, 'interrupted'); assert.ok(cancelled.record.archived)
})
