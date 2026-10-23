import assert from 'node:assert/strict'
import { test } from 'node:test'
import { demoFetch } from './transport.ts'
import { DemoWorkspaceStore } from './workspace-store.ts'
import { readDemoFeatureSnapshot } from './http-features.ts'
import { readDemoTaskSnapshot } from './http-tasks.ts'
import type { TaskItem } from '../../shared/task-list.ts'
import { TASK_TAG_PALETTE } from '../../shared/task-tag-colors.ts'
import { DEMO_DATABASE_ID } from './http-database.ts'

const write = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
async function data(store: DemoWorkspaceStore, path: string, init?: RequestInit) {
  const response = await demoFetch(store, path, init)
  assert.ok(response.ok, `${path}: ${await response.clone().text()}`)
  return response.json()
}
const editTask = (store: DemoWorkspaceStore, before: TaskItem | null, after: TaskItem | null, extras = {}) => data(store, '/api/task-list', write('PATCH', { workspace: store.workspaceInfo().path, changes: [{ id: before?.id ?? after!.id, before, after, afterId: null }], ...extras }))

test('features and scheduled tasks open their real shared documents without dirtying the initial Git snapshot', async () => {
  const store = new DemoWorkspaceStore()
  const features = await data(store, `/api/features?workspace=${encodeURIComponent(store.workspacePath)}`)
  assert.equal(features.features.length, 45)
  assert.equal(features.features.find((feature: { id: string }) => feature.id === 'mew-git-file-history').parentId, 'mew-git')
  const tasks = await data(store, '/api/task-list')
  assert.equal(tasks.tasks.length, 10)
  for (const task of tasks.tasks) { assert.match(store.readFile(task.path).content, /description:/) }
  for (const feature of features.features) assert.ok(store.readFile(feature.documentPath).content)
  assert.deepEqual(store.gitWorkingTree().files, [])
})

test('feature title edits rename the whole hierarchy and preserve links and external changes', async () => {
  const store = new DemoWorkspaceStore(), parent = readDemoFeatureSnapshot(store).features.find(feature => feature.id === 'mew-git')!
  store.writeFile('docs/feature-link.md', `[기능](features/${encodeURIComponent('Git·변경 이력')}/${encodeURIComponent('_Git·변경 이력.md')})\n`)
  const { feature } = await data(store, `/api/features/${parent.id}`, write('PATCH', { workspace: store.workspacePath, ...parent, title: '이력 기능' }))
  assert.equal(feature.documentPath, 'docs/features/이력 기능/_이력 기능.md')
  assert.ok(store.readFile('docs/features/이력 기능/현재 파일 커밋·이력 복원.md').content)
  assert.match(decodeURI(store.readFile('docs/feature-link.md').content), /이력 기능\/_이력 기능\.md/)
  assert.equal(readDemoFeatureSnapshot(store).features.find(item => item.id === 'mew-git-file-history')?.parentId, parent.id)
  const stale = await demoFetch(store, `/api/features/${parent.id}`, write('PATCH', { workspace: store.workspacePath, ...parent, title: '오래된 입력' }))
  assert.equal(stale.status, 409)
  const file = readDemoFeatureSnapshot(store).features.find(item => item.id === 'mew-database-references')!
  store.writeFile(file.documentPath!, store.readFile(file.documentPath!).content + '\n외부 편집\n')
  assert.match(readDemoFeatureSnapshot(store).features.find(item => item.id === file.id)!.content, /외부 편집/)
})

test('task fields, document bodies, tag colors and deletions stay in one shared state', async () => {
  const store = new DemoWorkspaceStore(), before = readDemoTaskSnapshot(store).tasks[0]
  const raw = store.readFile(before.path!).content
  store.writeFile(before.path!, raw + '\n직접 적은 메모\n')
  const after = { ...before, text: '제목을 바꾼 작업', done: true, tags: ['디자인'], assignees: ['visitor@example.test'], startDate: '2026-10-21', date: '2026-10-24' }
  const board = await editTask(store, before, after, { tagColorChanges: [{ tag: '디자인', before: null, after: TASK_TAG_PALETTE[1] }] })
  const saved = board.tasks.find((task: TaskItem) => task.id === before.id)
  assert.equal(saved.path, 'docs/tasks/제목을 바꾼 작업.md')
  assert.equal(saved.done, true)
  assert.equal(board.tagColors['디자인'], TASK_TAG_PALETTE[1])
  const content = store.readFile(saved.path).content
  assert.match(content, /직접 적은 메모/)
  assert.match(content, /description: "?태스크: 제목을 바꾼 작업/)
  assert.throws(() => store.readFile(before.path!), /찾을 수 없습니다/)
  const withoutTag = await data(store, '/api/task-list', write('PATCH', { workspace: store.workspacePath, changes: [], deletedTags: ['디자인'] }))
  assert.ok(withoutTag.tasks.every((task: TaskItem) => !task.tags?.includes('디자인')))
  assert.equal(withoutTag.tagColors['디자인'], undefined)
  await editTask(store, withoutTag.tasks.find((task: TaskItem) => task.id === before.id), null)
  assert.throws(() => store.readFile(saved.path), /찾을 수 없습니다/)
})

test('new task names reserve guides and preserve IDs across duplicate title changes', async () => {
  const store = new DemoWorkspaceStore(), first: TaskItem = { id: 'new-task', text: 'README', done: false }
  const board = await editTask(store, null, first), saved = board.tasks.find((task: TaskItem) => task.id === first.id)
  assert.equal(saved.path, 'docs/tasks/README (2).md')
  const again = await editTask(store, saved, { ...saved, text: 'mewlink' })
  assert.equal(again.tasks.find((task: TaskItem) => task.id === first.id).path, 'docs/tasks/mewlink (2).md')
  assert.equal(again.tasks.filter((task: TaskItem) => task.text === 'mewlink').length, 2)
})

test('direct task document edits refresh the panel and stale writes fail atomically', async () => {
  const store = new DemoWorkspaceStore(), task = readDemoTaskSnapshot(store).tasks[0]
  store.writeFile(task.path!, store.readFile(task.path!).content.replace(/^title:.*$/m, 'title: "문서에서 수정한 제목"'))
  assert.equal(readDemoTaskSnapshot(store).tasks.find(item => item.id === task.id)?.text, '문서에서 수정한 제목')
  const snapshot = store.repositoryEntries()
  const response = await demoFetch(store, '/api/task-list', write('PATCH', { workspace: store.workspacePath, changes: [{ id: task.id, before: task, after: { ...task, text: '오래된 변경' }, afterId: null }], tagColorChanges: [{ tag: '디자인', before: null, after: TASK_TAG_PALETTE[2] }] }))
  assert.equal(response.status, 409)
  assert.deepEqual(store.repositoryEntries(), snapshot)
  assert.deepEqual(readDemoTaskSnapshot(store).tagColors, {})
})

test('new project feature, task and database mutations are independent and reset removes them', async () => {
  const store = new DemoWorkspaceStore(), original = readDemoTaskSnapshot(store)
  store.createDirectory('Second'); store.seedProject(`${store.workspacePath}/Second`); store.openWorkspace(`${store.workspacePath}/Second`)
  const task = readDemoTaskSnapshot(store).tasks[0]
  await editTask(store, task, { ...task, text: '두 번째 프로젝트 작업' })
  const feature = readDemoFeatureSnapshot(store).features.find(item => item.id === 'mew-database-references')!
  await data(store, `/api/features/${feature.id}`, write('PATCH', { ...feature, title: '두 번째 초대', workspace: store.workspaceInfo().path }))
  const database = await data(store, `/api/db/${DEMO_DATABASE_ID}?project=docs`)
  await data(store, `/api/db/${DEMO_DATABASE_ID}/rows/${database.rows[0].id}`, write('PATCH', { project: 'docs', columnId: 'status', value: '완료' }))
  store.openWorkspace(store.workspacePath)
  assert.deepEqual(readDemoTaskSnapshot(store), original)
  assert.equal(readDemoFeatureSnapshot(store).features.find(item => item.id === feature.id)?.title, '기존 DB·외부 Postgres 참조')
  assert.equal((await data(store, `/api/db/${DEMO_DATABASE_ID}?project=docs`)).rows[0].cells.status, '예정')
  assert.equal((await demoFetch(store, `/api/features?workspace=${encodeURIComponent(`${store.workspacePath}/Second`)}`)).status, 409)
  store.reset()
  assert.deepEqual(store.gitWorkingTree().files, [])
  assert.equal(readDemoFeatureSnapshot(store).features.length, 45)
  assert.equal(readDemoTaskSnapshot(store).tasks.length, 10)
})

test('feature requests create demo documents once and support user status decisions', async () => {
  const store = new DemoWorkspaceStore(), input = { id: 'demo-new-feature', title: '검색 추가', content: '아이디어를 검색합니다.', agentSetId: 'demo-default', workspace: store.workspacePath }
  const first = await data(store, '/api/features/requests', write('POST', input))
  assert.equal(first.run.state, 'completed')
  assert.deepEqual((await data(store, '/api/features/requests', write('POST', input))).run, first.run)
  const feature = readDemoFeatureSnapshot(store).features.find(item => item.id === input.id)!
  const judged = await data(store, `/api/features/${feature.id}/status`, write('POST', { workspace: store.workspacePath, version: feature.version, status: 'verified' }))
  assert.equal(judged.feature.status, 'verified')
  assert.match(store.readFile(feature.documentPath!).content, /status: verified/)
})

test('task event streams refresh shared document edits and close when the panel request is cancelled', async () => {
  const store = new DemoWorkspaceStore(), controller = new AbortController()
  const response = await demoFetch(store, `/api/task-list/events?workspace=${encodeURIComponent(store.workspacePath)}`, { signal: controller.signal })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Content-Type')!, /text\/event-stream/)
  const reader = response.body!.getReader(), decoder = new TextDecoder()
  assert.match(decoder.decode((await reader.read()).value), /demo task events/)
  const task = readDemoTaskSnapshot(store).tasks[0]
  store.writeFile(task.path!, store.readFile(task.path!).content + '\n새 메모\n')
  assert.match(decoder.decode((await reader.read()).value), /^data:/)
  controller.abort()
  assert.equal((await reader.read()).done, true)
})

test('task document property strings from the shared editor remain readable and writable', async () => {
  const store = new DemoWorkspaceStore(), task = readDemoTaskSnapshot(store).tasks[0]
  store.writeFile(task.path!, `---\ntitle: ${JSON.stringify(task.text)}\ndone: "true"\ntags: '["시작하기", "디자인"]'\nassignees: '["visitor@example.test"]'\n---\n\n편집기 본문\n`)
  const edited = readDemoTaskSnapshot(store).tasks.find(item => item.id === task.id)!
  assert.deepEqual(edited.tags, ['시작하기', '디자인'])
  assert.deepEqual(edited.assignees, ['visitor@example.test'])
  assert.equal(edited.done, true)
  const result = await editTask(store, null, { id: 'new-after-editor', text: '문서를 연 뒤 새 작업', done: false, tags: [], assignees: [] })
  assert.ok(result.tasks.some((item: TaskItem) => item.id === 'new-after-editor'))
})
