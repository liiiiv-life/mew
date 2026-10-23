import assert from 'node:assert/strict'
import test from 'node:test'
import { DemoTerminal } from './terminal.ts'
import { DemoWorkspaceStore } from './workspace-store.ts'
import { createDemoSocketFactory } from './socket.ts'
import { demoFetch } from './transport.ts'
import { DemoRepository, type DemoRepositoryPayload } from './repository.ts'

function terminal(store = new DemoWorkspaceStore()) {
  let output = '', exited = false
  const shell = new DemoTerminal(store, chunk => { output += chunk }, () => { exited = true })
  shell.start()
  return { shell, store, get exited() { return exited }, run(command: string) { output = ''; shell.input(command + '\r'); return output }, input(data: string) { output = ''; shell.input(data); return output } }
}

function lazyTerminal(files: Record<string, string>, budget?: number) {
  const requests: string[] = [], pending = new Map<string, (payload: DemoRepositoryPayload) => void>()
  const entries = Object.fromEntries(Object.entries(files).map(([path, content], index) => [path, { oid: index.toString(16).padStart(64, '0'), size: new TextEncoder().encode(content).byteLength, binary: false }]))
  const repository = new DemoRepository({ format: 'mew-demo-snapshot/v2', revision: 'a'.repeat(40), files: entries }, oid => {
    requests.push(oid)
    return new Promise(resolve => { pending.set(oid, resolve) })
  }, budget)
  const store = new DemoWorkspaceStore(repository), session = terminal(store)
  return { ...session, repository, requests, resolve(path: string) {
    const oid = entries[path].oid, resolve = pending.get(oid)
    assert.ok(resolve, `pending request for ${path}`)
    pending.delete(oid); resolve({ content: files[path] })
  } }
}

const settleTerminal = () => new Promise<void>(resolve => setImmediate(resolve))

test('lazy shell reads preserve command and submitted line order with a bounded cache', async t => {
  const session = lazyTerminal({ 'notes/first.txt': 'first\n', 'notes/second.txt': 'second\n' }, 8)
  t.after(() => { session.shell.close(); session.store.close() })
  session.input('cat notes/first.txt notes/second.txt && echo joined > joined.txt\recho next >> joined.txt\r')
  assert.equal(session.requests.length, 1)
  assert.equal(session.store.hasFile('joined.txt'), false)
  session.resolve('notes/first.txt'); await settleTerminal()
  assert.equal(session.requests.length, 2)
  assert.equal(session.store.hasFile('joined.txt'), false)
  session.resolve('notes/second.txt'); await settleTerminal()
  assert.match(session.shell.replay(), /first\r\nsecond\r\n/)
  assert.equal(session.store.readFile('joined.txt').content, 'joined\nnext\n')
  assert.ok(session.repository.cachedBytes <= 8)
})

test('touch and ls do not load or replace lazy files; append preserves their contents', async t => {
  const session = lazyTerminal({ 'notes/lazy.txt': 'original\n' })
  t.after(() => { session.shell.close(); session.store.close() })
  session.run('touch notes/lazy.txt && ls notes/lazy.txt')
  assert.equal(session.requests.length, 0)
  assert.equal(session.store.isFileLoaded('notes/lazy.txt'), false)
  assert.equal(session.store.gitWorkingTree().files.length, 0)
  session.run('echo appended >> notes/lazy.txt && cat notes/lazy.txt')
  assert.equal(session.requests.length, 1)
  assert.equal(session.store.gitWorkingTree().files.length, 0)
  session.resolve('notes/lazy.txt'); await settleTerminal()
  assert.equal(session.store.readFile('notes/lazy.txt').content, 'original\nappended\n')
  assert.match(session.shell.replay(), /original\r\nappended\r\n/)
})

test('head, tail, wc and git diff fetch only the text they read', async t => {
  const session = lazyTerminal({ 'notes/lines.txt': 'one\ntwo\nthree\n', 'notes/unused.txt': 'unused\n' })
  t.after(() => { session.shell.close(); session.store.close() })
  session.run('head -n 1 notes/lines.txt && tail -n 1 notes/lines.txt && wc -l notes/lines.txt')
  assert.equal(session.requests.length, 1)
  session.resolve('notes/lines.txt'); await settleTerminal()
  assert.match(session.shell.replay(), /\r\none\r\n/)
  assert.match(session.shell.replay(), /\r\nthree\r\n/)
  assert.match(session.shell.replay(), /\r\n3 notes\/lines.txt\r\n/)
  assert.equal(session.requests.length, 1)
  session.run('echo replacement > notes/unused.txt && git diff notes/unused.txt')
  assert.equal(session.requests.length, 2)
  session.resolve('notes/unused.txt'); await settleTerminal()
  assert.match(session.shell.replay(), /-unused\r\n\+replacement\r\n/)
})

test('Ctrl+C, reset and close cancel pending shell reads before redirects or queued writes', async t => {
  for (const cancel of ['interrupt', 'reset', 'workspace-reset', 'close', 'workspace-close'] as const) {
    await t.test(cancel, async () => {
      const session = lazyTerminal({ 'notes/lazy.txt': 'source\n' })
      session.input('cat notes/lazy.txt > stale.txt && echo stale > conditional.txt\recho stale > queued.txt\r')
      if (cancel === 'interrupt') session.input('\x03')
      else if (cancel === 'reset') session.shell.reset()
      else if (cancel === 'workspace-reset') session.store.reset()
      else if (cancel === 'workspace-close') session.store.close()
      else session.shell.close()
      session.resolve('notes/lazy.txt'); await settleTerminal()
      assert.equal(session.store.hasFile('stale.txt'), false)
      assert.equal(session.store.hasFile('conditional.txt'), false)
      assert.equal(session.store.hasFile('queued.txt'), false)
      if (cancel !== 'close' && cancel !== 'workspace-close') {
        session.run('echo fresh > fresh.txt')
        assert.equal(session.store.readFile('fresh.txt').content, 'fresh\n')
      }
      session.shell.close(); session.store.close()
    })
  }
})

test('virtual shell edits quoted paths and shares files with explorer and Git', () => {
  const session = terminal()
  session.run('mkdir -p notes && cd notes && echo "Hello Mew" > "team note.md"')
  session.run("printf '\\nNext %s\\n' launch >> 'team note.md'")
  assert.equal(session.store.readFile('notes/team note.md').content, 'Hello Mew\n\nNext launch\n')
  assert.ok(session.store.tree('.workspace', 'notes').some(node => node.name === 'team note.md'))
  assert.ok(session.store.gitWorkingTree().files.some(file => file.path === 'notes/team note.md'))
  assert.match(session.run('cat "team note.md"'), /Hello Mew\r\n\r\nNext launch/)
  session.run('cp "team note.md" copy.md && mv copy.md renamed.md && touch empty.md')
  assert.equal(session.store.readFile('notes/renamed.md').content, 'Hello Mew\n\nNext launch\n')
  assert.equal(session.store.readFile('notes/empty.md').content, '')
  session.run('rm renamed.md empty.md && cd .. && rmdir notes')
  assert.ok(session.store.readFile('notes/team note.md'), 'rmdir refuses a nonempty directory')
  session.run('rm -rf notes')
  assert.throws(() => session.store.readFile('notes/team note.md'))
})

test('each shell keeps its own cwd even when the active project changes', () => {
  const store = new DemoWorkspaceStore(), first = terminal(store), second = terminal(store)
  first.run('cd docs')
  assert.equal(first.shell.cwd, `${store.workspacePath}/docs`)
  assert.equal(second.shell.cwd, store.workspacePath)
  store.openWorkspace(`${store.workspacePath}/src`)
  first.run('echo scoped > ../notes.md')
  assert.equal(store.readFile(`${store.workspacePath}/notes.md`).content, 'scoped\n')
  assert.match(first.run('cd - && pwd'), new RegExp(store.workspacePath))
  const third = terminal(store)
  assert.equal(third.shell.cwd, `${store.workspacePath}/src`)
  assert.match(third.run('cat main.tsx'), /import /)
})

test('shell confines paths and handles failures, conditionals and read commands', () => {
  const session = terminal()
  assert.match(session.run('rm -rf /'), /데모 작업 공간 밖/)
  assert.match(session.run('echo secret > ../../outside.txt'), /데모 작업 공간 밖/)
  assert.match(session.run('cd ../../ && touch forbidden.md || echo recovered'), /recovered\r\n/)
  assert.throws(() => session.store.readFile('forbidden.md'))
  assert.ok(session.store.readFile('docs/welcome.md').content)
  session.run("printf 'one\\ntwo\\nthree\\n' > lines.txt")
  assert.match(session.run('head -n 1 lines.txt'), /\r\none\r\n/)
  assert.match(session.run('tail -n 2 lines.txt'), /\r\ntwo\r\nthree\r\n/)
  assert.match(session.run('wc -l lines.txt'), /\r\n3 lines.txt\r\n/)
  session.run('touch .hidden')
  assert.match(session.run('ls -a'), /\.hidden/)
  assert.match(session.run('echo "unfinished'), /따옴표를 닫아/)
  assert.match(session.run('missing-command'), /command not found/)
})

test('shell git commits and branch changes use the same virtual repository', () => {
  const session = terminal()
  session.run('echo feature > feature.txt && git add . && git commit -m "Add feature"')
  assert.equal(session.store.gitLog().commits[0].subject, 'Add feature')
  assert.equal(session.store.gitWorkingTree().files.length, 0)
  session.run('git switch -c playground')
  assert.equal(session.store.gitRepository().branch, 'playground')
  session.run('git branch next')
  assert.equal(session.store.gitRepository().branch, 'playground')
  assert.match(session.run('git status'), /On branch playground/)
  session.run('echo changed > feature.txt && git restore feature.txt')
  assert.equal(session.store.readFile('feature.txt').content, 'feature\n')
  assert.match(session.run('npm test && npm run build'), /checks are simulated/)
  assert.match(session.run('exit'), /logout/)
  assert.equal(session.exited, true)
})

test('terminal line editing, history, completion and CRLF input execute the final draft', () => {
  const session = terminal()
  session.input('echo hlelo\x1b[D\x1b[D\x1b[D\x7f\x1b[Cl\x05 > edited.txt\r\n')
  assert.equal(session.store.readFile('edited.txt').content, 'hello\n')
  session.input('\x1b[A\r')
  assert.equal(session.store.readFile('edited.txt').content, 'hello\n')
  session.input('cat docs/wel\t\r')
  assert.match(session.shell.replay(), /Mew 데모에 오신 것을 환영합니다/)
  session.input('echo unwanted > cancelled.md\x03')
  assert.throws(() => session.store.readFile('cancelled.md'))
  const history = session.run('history')
  assert.equal((history.match(/  echo hello > edited.txt/g) ?? []).length, 1, 'history deduplicates repeated commands and treats CRLF as one enter')
})

test('named terminal reconnects preserve cwd and output; rename and removal share HTTP state', async t => {
  const store = new DemoWorkspaceStore(), factory = createDemoSocketFactory(store)
  t.after(() => { factory.close(); store.close() })
  const connect = async (name: string) => {
    const socket = factory(`wss://demo.test/api/tmux/ws?session=${name}`), chunks: string[] = []
    socket.onmessage = event => chunks.push(String(event.data))
    await new Promise<void>(resolve => queueMicrotask(() => queueMicrotask(resolve)))
    return { socket, chunks }
  }
  const first = await connect('demo-terminal')
  first.socket.send(JSON.stringify({ type: 'input', data: 'cd docs\recho saved > reconnect.md\r' }))
  first.socket.close()
  const reconnected = await connect('demo-terminal')
  assert.match(reconnected.chunks.join(''), /saved > reconnect.md/)
  reconnected.socket.send(JSON.stringify({ type: 'input', data: 'pwd\r' }))
  assert.match(reconnected.chunks.join(''), new RegExp(`${store.workspacePath}/docs`))
  const response = await demoFetch(store, '/api/tmux/sessions/demo-terminal/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newName: 'renamed' }) })
  assert.equal(response.status, 200)
  const renamed = await connect('renamed')
  assert.match(renamed.chunks.join(''), /saved > reconnect.md/)
  renamed.socket.send(JSON.stringify({ type: 'input', data: 'echo renamed > renamed.md\r' }))
  assert.equal(store.readFile('docs/renamed.md').content, 'renamed\n')
  await demoFetch(store, '/api/tmux/sessions/renamed', { method: 'DELETE' })
  assert.equal(renamed.socket.readyState, 3)
  assert.equal(reconnected.socket.readyState, 3)
  const deleted = await connect('renamed')
  assert.equal(deleted.socket.readyState, 3, 'a reconnect never revives a deleted terminal')
  const created = await demoFetch(store, '/api/tmux/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'renamed' }) })
  assert.equal(created.status, 200)
  const fresh = await connect('renamed')
  assert.equal(fresh.socket.readyState, 1)
  assert.doesNotMatch(fresh.chunks.join(''), /reconnect.md/)
  store.reset()
  fresh.socket.send(JSON.stringify({ type: 'input', data: 'pwd\r' }))
  assert.throws(() => store.readFile('docs/reconnect.md'))
  assert.match(fresh.chunks.join(''), new RegExp(store.workspacePath))
})

test('the common terminal runtime API starts at its project cwd and preserves a reconnected shell', async t => {
  const store = new DemoWorkspaceStore(), factory = createDemoSocketFactory(store)
  t.after(() => { factory.close(); store.close() })
  const project = `${store.workspacePath}/terminal-project`
  store.createDirectory(project); store.seedProject(project)
  const route = '/api/agent-runtimes/tmux/terminal/runtime-tab'
  const start = async () => {
    const response = await demoFetch(store, route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: project }) })
    assert.equal(response.status, 200)
    return response.json() as Promise<{ session: string }>
  }
  const { session } = await start()
  let output = ''
  const connect = async () => {
    const socket = factory(`wss://demo.test/api/tmux/ws?session=${session}`)
    socket.onmessage = event => { output += String(event.data) }
    await new Promise<void>(resolve => queueMicrotask(() => queueMicrotask(resolve)))
    return socket
  }
  const first = await connect()
  first.send(JSON.stringify({ type: 'input', data: 'pwd\rcd docs\recho project-only > scoped.md\r' }))
  assert.match(output, new RegExp(project))
  assert.equal(store.readFile(`${project}/docs/scoped.md`).content, 'project-only\n')
  assert.throws(() => store.readFile(`${store.workspacePath}/docs/scoped.md`))
  first.close()
  assert.equal((await start()).session, session)
  const reconnected = await connect()
  reconnected.send(JSON.stringify({ type: 'input', data: 'echo continued > resumed.md\r' }))
  assert.equal(store.readFile(`${project}/docs/resumed.md`).content, 'continued\n')
  assert.equal((await demoFetch(store, route, { method: 'DELETE' })).status, 200)
  assert.equal(reconnected.readyState, 3)
})

test('renaming before the first connection preserves cwd and deleting clears it before reuse', async t => {
  const store = new DemoWorkspaceStore(), factory = createDemoSocketFactory(store)
  t.after(() => { factory.close(); store.close() })
  const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const response = await demoFetch(store, '/api/agent-runtimes/tmux/terminal/rename-tab', post({ cwd: `${store.workspacePath}/docs` }))
  const { session } = await response.json()
  assert.equal((await demoFetch(store, `/api/tmux/sessions/${session}/rename`, post({ newName: 'renamed-before-open' }))).status, 200)
  const connect = async () => {
    const socket = factory('wss://demo.test/api/tmux/ws?session=renamed-before-open')
    await new Promise<void>(resolve => queueMicrotask(() => queueMicrotask(resolve)))
    return socket
  }
  const first = await connect()
  first.send(JSON.stringify({ type: 'input', data: 'echo first > rename-cwd.txt\r' }))
  assert.equal(store.readFile('docs/rename-cwd.txt').content, 'first\n')
  assert.equal((await demoFetch(store, '/api/tmux/sessions/renamed-before-open', { method: 'DELETE' })).status, 200)
  assert.equal((await demoFetch(store, '/api/tmux/sessions', post({ name: 'renamed-before-open' }))).status, 200)
  const second = await connect()
  second.send(JSON.stringify({ type: 'input', data: 'echo second > rename-cwd.txt\r' }))
  assert.equal(store.readFile('rename-cwd.txt').content, 'second\n')
  assert.equal(store.readFile('docs/rename-cwd.txt').content, 'first\n')
})
