import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { parseDocument } from 'yaml'
import snapshot from './repository-snapshot.json' with { type: 'json' }
import { DEMO_FILES, DEMO_FILE_PATH } from './fixtures.ts'
import { DemoWorkspaceStore } from './workspace-store.ts'
import { demoFetch } from './transport.ts'
import { DEMO_DATABASE_ID } from './http-database.ts'
import { readDemoTaskSnapshot } from './http-tasks.ts'
import { MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_GZIP_BYTES, includeDemoSource } from '../../tools/demo-snapshot.mjs'

test('the demo adds just its welcome document to a bounded, public Mew snapshot', () => {
  assert.equal(snapshot.format, 'mew-demo-snapshot/v1')
  assert.match(snapshot.revision, /^[a-f0-9]{40}$/)
  assert.deepEqual(Object.keys(DEMO_FILES).filter(file => !(file in snapshot.files)), [DEMO_FILE_PATH])
  for (const [file, content] of Object.entries(snapshot.files)) {
    assert.equal(DEMO_FILES[file], content)
    assert.ok(includeDemoSource(file, Buffer.byteLength(content)), file)
  }
  assert.match(DEMO_FILES['README.md'], /my easy workspace/)
  assert.match(DEMO_FILES['src/main.tsx'], /import /)
  assert.ok(!JSON.stringify(DEMO_FILES).includes('Studio North'))
  const json = JSON.stringify(snapshot, null, 2) + '\n'
  assert.ok(Buffer.byteLength(json) <= MAX_SNAPSHOT_BYTES)
  assert.ok(gzipSync(json).byteLength <= MAX_SNAPSHOT_GZIP_BYTES)
})

test('the welcome links resolve, documents keep descriptions and task accounts are omitted', () => {
  for (const [file, content] of Object.entries(DEMO_FILES)) {
    if (!file.startsWith('docs/') || !file.endsWith('.md')) continue
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
    assert.ok(frontmatter, `${file}: frontmatter`)
    const document = parseDocument(frontmatter[1])
    assert.deepEqual(document.errors, [], `${file}: YAML`)
    assert.ok(typeof document.get('description') === 'string' && document.get('description').trim(), `${file}: description`)
    if (file.startsWith('docs/tasks/')) assert.equal(document.has('assignees'), false)
  }
  for (const match of DEMO_FILES[DEMO_FILE_PATH].matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = path.posix.normalize(path.posix.join('docs', decodeURIComponent(match[1])))
    assert.ok(target in DEMO_FILES, `${match[1]} → ${target}`)
  }
  assert.match(DEMO_FILES[DEMO_FILE_PATH], /영구 저장되지 않습니다/)
})

test('source copies and a second visitor stay untouched by edits, commits, reset and project seeding', () => {
  const store = new DemoWorkspaceStore(), other = new DemoWorkspaceStore()
  const initial = store.repositoryEntries()
  assert.deepEqual(store.gitWorkingTree().files, [])
  store.writeFile('src/main.tsx', '// visitor change\n')
  store.writeFile(DEMO_FILE_PATH, '# visitor note\n')
  store.commit('Try Mew edits')
  assert.equal(other.readFile('src/main.tsx').content, snapshot.files['src/main.tsx'])
  assert.equal(DEMO_FILES['src/main.tsx'], snapshot.files['src/main.tsx'])
  store.reset()
  assert.deepEqual(store.repositoryEntries(), initial)
  assert.deepEqual(store.gitWorkingTree().files, [])
  store.createDirectory('Second'); store.seedProject(`${store.workspacePath}/Second`)
  store.openWorkspace(`${store.workspacePath}/Second`)
  for (const file of ['README.md', 'src/main.tsx', DEMO_FILE_PATH]) assert.equal(store.readFile(file).content, DEMO_FILES[file])
})

test('the editable database starts from actual Mew tasks without fictional team data', async () => {
  const store = new DemoWorkspaceStore()
  const response = await demoFetch(store, `/api/db/${DEMO_DATABASE_ID}?project=docs`)
  assert.equal(response.status, 200)
  const view = await response.json(), tasks = readDemoTaskSnapshot(store).tasks
  assert.deepEqual(view.rows.map((row: { cells: { title: string } }) => row.cells.title), tasks.map(task => task.text))
  assert.equal(new Set(view.rows.map((row: { id: string }) => row.id)).size, view.rows.length)
  for (const row of view.rows) assert.equal(row.cells.done, row.cells.status === '완료')
})
