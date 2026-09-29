import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'
import type { AgentEvent } from './agentAcp.ts'
import type { AgentAttachmentInput } from '../shared/agent-attachment.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-queue-attachments-'))
process.env.MEW_WORKSPACE = root
process.env.MEW_DATA_DIR = path.join(root, 'data')
const stub = path.join(root, 'stub.mjs')
fs.writeFileSync(stub, `
import fs from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(import.meta.resolve('@agentclientprotocol/sdk'))}
let modelId = 'alpha', effort = 'low', modeId = 'default'
const config = () => [{id:'effort',name:'Effort',category:'thought_level',type:'select',currentValue:effort,options:[{value:'low',name:'Low'},{value:'high',name:'High'}]}]
new AgentSideConnection(conn => ({
  initialize: async () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }),
  newSession: async () => ({ sessionId: 'attachments', models:{currentModelId:modelId,availableModels:[{modelId:'alpha',name:'Alpha'},{modelId:'beta',name:'Beta'}]}, modes:{currentModeId:modeId,availableModes:[{id:'default',name:'Default'},{id:'bypassPermissions',name:'Bypass'}]},configOptions:config() }),
  unstable_setSessionModel: async (value) => { modelId=value.modelId; return {} },
  setSessionMode: async (value) => { modeId=value.modeId; return {} },
  setSessionConfigOption: async (value) => { effort=value.value; return {configOptions:config()} },
  cancel: async () => {},
  prompt: async ({ sessionId, prompt }) => {
    fs.appendFileSync(${JSON.stringify(path.join(root, 'settings-log'))}, JSON.stringify({modelId,effort,modeId,text:prompt[0].text})+'\\n')
    if (prompt[0].text === 'hold') while (!fs.existsSync(${JSON.stringify(path.join(root, 'release'))})) await new Promise(resolve => setTimeout(resolve, 10))
    await conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(prompt) } } })
    return { stopReason: 'end_turn' }
  },
}), ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
`)
process.env.MEW_AGENT_CMD = process.env.MEW_AGENT_CODEX_CMD = process.execPath
process.env.MEW_AGENT_ARGS = process.env.MEW_AGENT_CODEX_ARGS = stub
const { attachAgentWebSocket } = await import('./agentWs.ts')
const { shutdownAgentHostsForWorkspace } = await import('./agentHost.ts')

async function until(check: () => boolean) {
  const end = Date.now() + 8000
  while (!check()) {
    assert.ok(Date.now() < end, 'timed out waiting for queue event')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('WS and supervisor relay queue attachment metadata and edit file refs for Codex and Claude', { timeout: 30_000 }, async t => {
  const server = http.createServer()
  attachAgentWebSocket(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  t.after(() => {
    shutdownAgentHostsForWorkspace(root)
    server.close()
    setTimeout(() => fs.rmSync(root, { recursive: true, force: true }), 200)
  })
  for (const runtime of ['codex', 'claude']) {
    fs.rmSync(path.join(root, 'release'), { force: true })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/agent/ws?tab=${runtime}&runtime=${runtime}`)
    t.after(() => ws.terminate())
    const events: AgentEvent[] = []
    ws.on('message', raw => events.push(JSON.parse(raw.toString())))
    const send = (value: unknown) => ws.send(JSON.stringify(value))
    const meta = () => events.findLast(event => event.type === 'meta')?.meta
    await until(() => !!meta()?.sessionId)
    const file: AgentAttachmentInput = { project: 'test', path: '.mew/files/photo.png', mimeType: 'image/png' }
    const image = { data: 'aW1hZ2U=', mimeType: 'image/png' }
    send({ type: 'set_mode', modeId: 'default' })
    await until(() => events.findLast(event => event.type === 'modes')?.modes.currentModeId === 'default')
    send({ type: 'prompt', text: 'hold' })
    send({ type: 'prompt', text: 'original\n[[test:.mew/files/photo.png]]', displayText: 'original', attachments: [file], images: [image], imageRefs: [file] })
    send({ type: 'begin_edit_queued', index: 0, expect: 'original' })
    await until(() => meta()?.queuedAttachments?.[0]?.length === 1)
    assert.deepEqual(meta()?.queuedAttachments, [[file]])
    assert.equal(meta()?.queuedSettings?.[0]?.modelId, 'alpha', 'queue snapshots the original model even for older clients')
    assert.equal(meta()?.queuedSettings?.[0]?.modeId, 'default')
    send({ type: 'set_model', modelId: 'beta' })
    send({ type: 'set_mode', modeId: 'bypassPermissions' })
    await until(() => events.some(event => event.type === 'models' && event.models.currentModelId === 'beta') && events.some(event => event.type === 'modes' && event.modes.currentModeId === 'bypassPermissions'))
    assert.equal(meta()?.queuedSettings?.[0]?.modelId, 'alpha', 'later selections do not rewrite the queued snapshot')
    fs.writeFileSync(path.join(root, 'release'), '')
    await until(() => meta()?.busy === false)
    assert.deepEqual(meta()?.queued, ['original'])
    const pdf = { project: 'test', path: '.mew/files/notes.pdf', mimeType: 'application/pdf' }
    const settings = { model: 'Alpha', thinking: 'High', permission: 'Default', modelId: 'alpha', thinkingId: 'high', thinkingConfigId: 'effort', modeId: 'default' }
    send({ type: 'edit_queued', index: 0, expect: 'original', text: 'edited', attachments: [file, pdf], settings })
    await until(() => events.filter(event => event.type === 'turn_end').length === 2)
    const reply = events.findLast(event => event.type === 'update' && event.update.sessionUpdate === 'agent_message_chunk')
    assert.ok(reply?.type === 'update' && reply.update.sessionUpdate === 'agent_message_chunk')
    const blocks = JSON.parse((reply.update.content as { text: string }).text) as { type: string; text?: string; data?: string }[]
    assert.equal(blocks[0].text, 'edited\n[[test:.mew/files/photo.png]]\n[[test:.mew/files/notes.pdf]]')
    assert.deepEqual(blocks.filter(block => block.type === 'image').map(block => block.data), runtime === 'codex' ? [image.data] : [])
    await until(() => meta()?.busy === false)
    const settingsLog = fs.readFileSync(path.join(root, 'settings-log'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(settingsLog.at(-1), { modelId:'alpha', effort:'high', modeId:'default', text:blocks[0].text }, 'queued execution uses the edited IDs through WS and supervisor')
    const user = events.findLast(event => event.type === 'update' && event.update.sessionUpdate === 'user_message_chunk')
    assert.ok(user?.type === 'update')
    assert.deepEqual(user.settings, settings)
    assert.equal(events.findLast(event => event.type === 'models')?.models.currentModelId, 'beta', 'queue execution does not overwrite draft model')
    send({ type:'prompt', text:'after' })
    await until(() => events.filter(event => event.type === 'turn_end').length === 3)
    const after = JSON.parse(fs.readFileSync(path.join(root, 'settings-log'), 'utf8').trim().split('\n').at(-1)!)
    assert.equal(after.modelId, 'beta', 'runtime restores the later composer model after the queued turn')
    assert.equal(after.modeId, 'bypassPermissions')
    ws.close()
  }
})
