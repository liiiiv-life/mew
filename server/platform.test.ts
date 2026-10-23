import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createPrivateIpcServer, listenPrivateIpc, connectPrivateIpc, removeIpcEndpoint } from './platform/ipc.ts'
import { ipcEndpoint as windowsEndpoint } from './platform/windows/ipc.ts'
import { hostPaths as windowsPaths, directoryAclScript, protectDirectory, powershell, encodedPowerShell, quotePowerShell } from './platform/windows/storage.ts'
import { windowsEnvironment } from './platform/windows/process.ts'
import { windowsCommand } from './platform/windows/command.ts'
import { withinPath, validWindowsRelativePath } from './platform/common/paths.ts'
import { cronMatches, validCron } from './platform/common/cron.ts'
import { scheduledTaskScript } from './platform/windows/scheduler.ts'
import { tmuxBackend } from '../packages/tmux-term/src/server/backends/tmux.ts'
import { psmuxBackend } from '../packages/tmux-term/src/server/backends/psmux.ts'

test('OS backends preserve POSIX argv and encode PowerShell text without interpreting paths', () => {
  assert.deepEqual(tmuxBackend.commandArgs('test', 'echo hello', '/workspace'), ['new-session', '-d', '-s', 'test', '-c', '/workspace', '/bin/sh', '-c', 'echo hello'])
  const script = "Write-Output '한글 & | % 😀'"
  const args = psmuxBackend.commandArgs('test', script, "C:\\O'Brien")
  assert.equal(Buffer.from(args.at(-1)!, 'base64').toString('utf16le'), script)
  assert.equal(args[args.indexOf('-c') + 1], "C:\\O'Brien")
  const wrapped = windowsCommand("C:\\O'Brien\\record.json", 'C:\\complete.json', 'C:\\drained')
  const wrapper = Buffer.from(wrapped.args.at(-1)!, 'base64').toString('utf16le')
  const inner = Buffer.from([...wrapper.matchAll(/'([A-Za-z0-9+/=]{32,})'/g)].at(-1)![1], 'base64').toString('utf16le')
  assert.ok(inner.includes("C:\\O''Brien\\record.json"))
  assert.ok(!wrapper.includes(script))
})

test('Windows ACL replaces inherited access with the current SID and SYSTEM', { skip: process.platform !== 'win32' }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-win-acl-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  protectDirectory(directory)
  const script = `$acl=Get-Acl -LiteralPath ${quotePowerShell(directory)}; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; @{protected=$acl.AreAccessRulesProtected; sid=$sid; entries=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object {$_.IdentityReference.Value})} | ConvertTo-Json -Compress`
  const result = JSON.parse((await promisify(execFile)(powershell(), encodedPowerShell(script), { timeout: 15000 })).stdout)
  assert.ok(result.protected)
  assert.deepEqual([...new Set(result.entries)].sort(), [result.sid, 'S-1-5-18'].sort())
})

test('Windows command wrapper records explicit exit and drains Unicode output', { skip: process.platform !== 'win32' }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mew O'Brien command "))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const record = path.join(directory, 'record.json'), completed = path.join(directory, 'complete.json'), drained = path.join(directory, 'drained')
  fs.writeFileSync(record, JSON.stringify({ command: "[Console]::WriteLine('한글😀 & |'); exit 23" }))
  fs.writeFileSync(drained, '')
  const wrapped = windowsCommand(record, completed, drained)
  const result = await promisify(execFile)(wrapped.args[2], wrapped.args.slice(3), { timeout: 15000 }).then(() => { throw new Error('Expected command failure') }, error => error)
  assert.equal(result.code, 23)
  assert.ok(result.stdout.includes('한글😀 & |'))
  assert.equal(JSON.parse(fs.readFileSync(completed, 'utf8')).exitCode, 23)
})

test('Windows paths isolate state and refuse drive escapes, ADS and device filenames', () => {
  assert.equal(windowsPaths({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }).data, 'C:\\Users\\me\\AppData\\Local\\mew\\data')
  assert.ok(withinPath('C:\\Work', 'c:\\work\\project\\a.md', 'win32'))
  assert.ok(!withinPath('C:\\Work', 'D:\\Work\\a.md', 'win32'))
  assert.ok(!withinPath('C:\\Work', 'C:\\Workspace\\a.md', 'win32'))
  for (const value of ['file:token', 'CON.txt', 'aux', 'a.', 'a ', 'a\\LPT1.md', 'COM¹.log', 'control\x01']) assert.equal(validWindowsRelativePath(value), false)
  assert.ok(validWindowsRelativePath('문서/hello.md'))
  assert.deepEqual(windowsEnvironment({ Path: 'old', PATH: 'new', OPENAI_API_KEY: undefined }), { PATH: 'new', OPENAI_API_KEY: undefined })
  const endpoint = windowsEndpoint('C:\\state\\host.sock')
  assert.ok(endpoint.startsWith('\\\\.\\pipe\\mew-'))
  assert.equal(endpoint, windowsEndpoint('c:\\STATE\\host.sock'))
  assert.ok(directoryAclScript("C:\\O'Brien").includes("C:\\O''Brien"))
})

test('authenticated IPC admits valid peers and rejects a wrong private key before application data', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-private-ipc-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'test.sock')
  const endpoint = process.platform === 'win32' ? windowsEndpoint(file) : file
  let accepted = 0
  const server = createPrivateIpcServer(endpoint, directory, socket => {
    accepted++
    socket.on('error', () => {})
    socket.on('data', data => socket.end(data))
  }, true)
  await listenPrivateIpc(server, endpoint)
  t.after(() => { server.close(); removeIpcEndpoint(endpoint) })
  const client = await connectPrivateIpc(endpoint, directory, true)
  const data = once(client, 'data')
  client.resume(); client.write('fixture 한글😀\n')
  assert.equal((await data)[0].toString(), 'fixture 한글😀\n')
  const wrong = path.join(directory, 'wrong')
  fs.mkdirSync(wrong); fs.writeFileSync(path.join(wrong, '.ipc-key'), '0'.repeat(64))
  await assert.rejects(connectPrivateIpc(endpoint, wrong, true), /authentication/)
  assert.equal(accepted, 1)
  const attacker = net.createConnection(endpoint)
  attacker.on('error', () => {})
  const closed = once(attacker, 'close')
  attacker.once('data', data => {
    const challenge = JSON.parse(data.toString())
    // A server proof cannot be replayed as a client proof.
    attacker.write(JSON.stringify({ nonce: challenge.nonce, proof: challenge.proof }) + '\n')
  })
  await closed
  assert.equal(accepted, 1)
})

test('Windows scheduled execution matches cron steps and day OR semantics in local time', () => {
  const date = new Date(2026, 9, 14, 10, 30)
  assert.ok(cronMatches('*/15 10 * oct wed', date))
  assert.ok(cronMatches('30 10 1 * wed', date))
  assert.ok(!cronMatches('30 10 1 * *', date))
  assert.ok(!cronMatches('*/0 * * * *', date))
  assert.ok(!cronMatches('30 10 * * mon', date))
  assert.ok(!cronMatches('30 10 */2 * wed', date))
  for (const expression of ['60 * * * *', '1,garbage * * * *', '* * * * 1-3-5', '*/0 * * * *']) assert.equal(validCron(expression), false)
  const task = scheduledTaskScript("C:\\O'Brien\\state", true)
  assert.ok(task.includes("-RunLevel Limited"))
  assert.ok(task.includes("-LogonType Interactive"))
  assert.ok(!task.includes('Register-ScheduledTask -User'))
})
