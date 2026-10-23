import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { relayMewcatRequest } from './mewcat-mcp-stdio.ts'

test('debugger MCP is opt-in, scopes references and immediately closes on permission revocation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-debugger-mcp-')); process.env.MEW_DATA_DIR = root; process.env.MEW_WORKSPACE = root
  const { upsertUser } = await import('./auth.ts'), { setFeature } = await import('./access-policy.ts'), { saveDebugConfig, debugSession } = await import('./debugger.ts'), { debuggerMcpServers, DebuggerBinding } = await import('./debugger-mcp.ts'), { defaultDebugConfig } = await import('../shared/debugger.ts')
  const account = 'debug@example.test'; upsertUser(account, { hash: 'fixture', role: 'manager', mustChangePassword: false, createdAt: 0, passwordChangedAt: 0 })
  assert.deepEqual(await debuggerMcpServers(account, root), [])
  const config = { ...defaultDebugConfig('custom', root), agentBridge: true, command: process.execPath, args: [new URL('./fixtures/debug-adapter.cjs', import.meta.url).pathname], breakpoints: [{ file: 'main.js', line: 3, enabled: true }] }
  await saveDebugConfig(account, root, config)
  const binding = new DebuggerBinding(account, root); await binding.listen()
  t.after(async () => { binding.close(); await debugSession(account, root)?.stop(); await fs.rm(root, { recursive: true, force: true }) })
  assert.equal((await fs.stat(binding.socketPath)).mode & 0o777, 0o600)
  const handshake = await new Promise<any[]>((resolve, reject) => {
    const child = spawn(process.execPath, [new URL('./debugger-mcp-stdio.ts', import.meta.url).pathname, binding.socketPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', errors = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('MCP stdio handshake timed out')) }, 3000)
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { errors += chunk })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); if (code) reject(new Error(errors || `MCP exited ${code}`)); else { try { resolve(output.trim().split('\n').map(line => JSON.parse(line))) } catch (error) { reject(error) } } })
    child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)
  })
  assert.equal(handshake.find(r => r.id === 1).result.serverInfo.name, 'mew-debugger')
  assert.equal(handshake.find(r => r.id === 2).result.tools.length, 4)
  const rpc = async (method: string, params?: unknown) => JSON.parse(await relayMewcatRequest(binding.socketPath, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })))
  assert.equal((await rpc('tools/list')).result.tools.length, 4)
  const tool = async (name: string, args = {}) => (await rpc('tools/call', { name, arguments: args })).result
  assert.equal((await tool('debugger_start')).isError, undefined)
  const deadline = Date.now() + 2000
  while (!debugSession(account, root)?.snapshot.frames.length) { assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 10)) }
  const state = JSON.parse((await tool('debugger_state')).content[0].text)
  assert.equal((await tool('debugger_command', { sessionId: 'wrong', command: 'continue', arguments: {} })).isError, true)
  assert.equal((await tool('debugger_command', { sessionId: state.id, command: 'scopes', arguments: { frameId: 1 } })).isError, true)
  assert.equal((await tool('debugger_command', { sessionId: state.id, command: 'scopes', arguments: { frameId: 1, connectionId: 'other', stopRevision: state.stopRevision } })).isError, true)
  assert.equal((await tool('debugger_command', { sessionId: state.id, command: 'scopes', arguments: { frameId: 1, connectionId: state.connectionId, stopRevision: state.stopRevision - 1 } })).isError, true)
  const result = await tool('debugger_command', { sessionId: state.id, command: 'scopes', arguments: { frameId: 1, connectionId: state.connectionId, stopRevision: state.stopRevision } })
  assert.equal(JSON.parse(result.content[0].text).scopes[0].variablesReference, 10)
  setFeature(account, 'agent', false)
  await assert.rejects(fs.stat(binding.socketPath), /ENOENT/)
  assert.deepEqual(await debuggerMcpServers(account, root), [])
  const forbidden = await binding.rpc(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'debugger_state' } })); assert.ok('result' in forbidden); assert.equal(forbidden.result.isError, true)
})
