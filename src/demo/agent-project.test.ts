import assert from 'node:assert/strict'
import test from 'node:test'
import { createDemoSocketFactory } from './socket.ts'
import { DemoWorkspaceStore } from './workspace-store.ts'

async function completeTurn(factory: ReturnType<typeof createDemoSocketFactory>, cwd: string): Promise<void> {
  const socket = factory(`wss://demo.test/api/agent/ws?tab=${encodeURIComponent(cwd)}&cwd=${encodeURIComponent(cwd)}`)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Demo agent turn timed out')), 3000)
    socket.onopen = () => socket.send(JSON.stringify({ type: 'prompt', text: '출시 계획을 정리해 주세요' }))
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data))
      if (message.type === 'error') { clearTimeout(timeout); reject(new Error(message.message)) }
      if (message.type === 'turn_end') { clearTimeout(timeout); resolve() }
    }
  })
  socket.close()
}

test('agent modifies the project owning its session cwd after the selected project changes', async t => {
  const store = new DemoWorkspaceStore(), factory = createDemoSocketFactory(store)
  t.after(() => { factory.close(); store.close() })
  const root = store.workspacePath, project = `${root}/second-project`
  store.createDirectory(project); store.seedProject(project)
  const initial = store.readFile(`${root}/docs/welcome.md`).content
  store.openWorkspace(`${root}/docs`)
  await completeTurn(factory, `${project}/src`)
  assert.match(store.readFile(`${project}/docs/welcome.md`).content, /에이전트와 정리한 다음 단계/)
  assert.equal(store.readFile(`${root}/docs/welcome.md`).content, initial)
})

test('agent creates an example document when its chosen cwd has no documents', async t => {
  const store = new DemoWorkspaceStore(), factory = createDemoSocketFactory(store)
  t.after(() => { factory.close(); store.close() })
  const initial = store.readFile('docs/welcome.md').content
  await completeTurn(factory, `${store.workspacePath}/src`)
  assert.match(store.readFile('src/docs/welcome.md').content, /에이전트와 정리한 다음 단계/)
  assert.equal(store.readFile('docs/welcome.md').content, initial)
})
