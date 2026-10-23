import '../test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { readyFileCatalog, resetFileCatalogs } from '../fileCatalog.ts'
import { workspaceContext, pathsForWorkspace } from '../paths.ts'
import { rowPageName, syncDatabasePages } from './rowPages.ts'
import type { DatabaseView } from './databaseService.ts'
import type { Exec } from './pool.ts'

const dbId = '11111111-1111-4111-8111-111111111111'
const rowId = '22222222-2222-4222-8222-222222222222'
const view = (ownerPath: string): DatabaseView => ({ id: dbId, title: '사람', kind: 'managed', editable: true, ownerPath,
  columns: [{ id: 'title', name: '제목', type: 'page' }], rows: [{ id: rowId, pos: 0, cells: { title: '송상훈' } }] })

function fixture(t: test.TestContext, run: (root: string, q: Exec, records: Map<string, { row_id: string; path: string; baseline: unknown }>) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-row-layout-'))
  fs.mkdirSync(path.join(root, 'docs'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const records = new Map<string, { row_id: string; path: string; baseline: unknown }>()
  const q = (async (sql: string, args: unknown[] = []) => {
    if (sql.startsWith('SELECT row_id')) return { rows: [...records.values()], rowCount: records.size }
    if (sql.startsWith('INSERT INTO mew.row_pages')) records.set(String(args[1]), { row_id: String(args[1]), path: String(args[2]), baseline: JSON.parse(String(args[3])) })
    return { rows: [], rowCount: 0 }
  }) as Exec
  return workspaceContext.run(pathsForWorkspace(root, null), async () => {
    try { await run(path.join(root, 'docs'), q, records) }
    finally { await readyFileCatalog('docs'); resetFileCatalogs() }
  })
}

test('row pages promote their owner and use the row title, preserving links and IDs', t => fixture(t, async (root, q, records) => {
  fs.writeFileSync(path.join(root, '사람.md'), '# 사람\n\n[연결](참조.md)\n')
  fs.writeFileSync(path.join(root, '참조.md'), '[사람](사람.md)\n')
  const current = view('사람.md')
  const change = await syncDatabasePages('docs', current, q)
  assert.equal(current.ownerPath, '사람/_사람.md')
  assert.equal(records.get(rowId)?.path, '사람/송상훈.md')
  const content = fs.readFileSync(path.join(root, '사람/송상훈.md'), 'utf8')
  const fields = parse(content.split('---')[1])
  assert.equal(fields._mew_row, rowId)
  assert.equal(fields.상위파일, '_사람.md')
  assert.match(fs.readFileSync(path.join(root, '사람/_사람.md'), 'utf8'), /\.\.\//)
  assert.match(fs.readFileSync(path.join(root, '참조.md'), 'utf8'), /_.*\.md/)
  assert.equal(fs.existsSync(path.join(root, '데이터베이스')), false)
  assert.equal(change.mutation?.moves[0].from, '사람.md')
  change.rollback()
  assert.equal(fs.existsSync(path.join(root, '사람')), false)
  assert.equal(fs.readFileSync(path.join(root, '참조.md'), 'utf8'), '[사람](사람.md)\n')
  assert.equal(fs.existsSync(path.join(root, '사람.md')), true)
}))

test('legacy UUID pages migrate under the actual owner without losing bodies, fields or link targets', t => fixture(t, async (root, q, records) => {
  fs.mkdirSync(path.join(root, 'Books'))
  const owner = 'Books/_Books.md', old = `데이터베이스/${dbId}/${rowId}.md`, rep = `데이터베이스/${dbId}/_${dbId}.md`
  fs.writeFileSync(path.join(root, owner), `<div data-mew-db="${dbId}"></div>\n`)
  fs.mkdirSync(path.dirname(path.join(root, old)), { recursive: true })
  fs.writeFileSync(path.join(root, rep), `---\n_mew_database: ${dbId}\ntitle: 사람\n---\n\n`)
  fs.writeFileSync(path.join(root, old), `---\n_mew_database: ${dbId}\n_mew_row: ${rowId}\ntitle: 송상훈\n메모: 보존\n---\n# 본문\n[참조](../../참조.md)\n`)
  fs.writeFileSync(path.join(root, '참조.md'), `[행](${old})\n`)
  records.set(rowId, { row_id: rowId, path: old, baseline: {} })
  const current = { ...view('Books.md'), ownerPath: null } // Recover an owner missing from old DB metadata.
  const change = await syncDatabasePages('docs', current, q)
  assert.equal(current.ownerPath, owner)
  assert.equal(records.get(rowId)?.path, 'Books/송상훈.md')
  const content = fs.readFileSync(path.join(root, 'Books/송상훈.md'), 'utf8')
  assert.match(content, /메모: 보존/)
  assert.match(content, /# 본문/)
  assert.match(content, /\.\.\//)
  assert.equal(fs.existsSync(path.join(root, old)), false)
  change.commit()
  assert.equal(fs.existsSync(path.join(root, '데이터베이스')), false)
  assert.match(fs.readFileSync(path.join(root, '참조.md'), 'utf8'), /Books\//)
  const oldRuntimeRep = `Books/데이터베이스/${dbId}/_${dbId}.md`
  fs.mkdirSync(path.dirname(path.join(root, oldRuntimeRep)), { recursive: true })
  fs.writeFileSync(path.join(root, oldRuntimeRep), `---\n_mew_database: ${dbId}\n---\n\n`)
  const repeat = await syncDatabasePages('docs', current, q)
  assert.equal(repeat.mutation, undefined)
  repeat.commit()
  assert.equal(fs.existsSync(path.join(root, 'Books/데이터베이스')), false)
}))

test('title collisions with files and folders never overwrite unrelated content', t => fixture(t, async (root, q, records) => {
  fs.mkdirSync(path.join(root, 'Books'))
  fs.writeFileSync(path.join(root, 'Books/_Books.md'), '# Books')
  fs.writeFileSync(path.join(root, 'Books/송상훈.md'), '원본')
  fs.mkdirSync(path.join(root, 'Books/송상훈 2'))
  const change = await syncDatabasePages('docs', view('Books/_Books.md'), q)
  assert.equal(records.get(rowId)?.path, 'Books/송상훈 3.md')
  assert.equal(fs.readFileSync(path.join(root, 'Books/송상훈.md'), 'utf8'), '원본')
  change.rollback()
}))

test('owner promotion collisions leave the owner and all files intact', t => fixture(t, async (root, q) => {
  fs.writeFileSync(path.join(root, '사람.md'), '# 사람')
  fs.mkdirSync(path.join(root, '사람'))
  await assert.rejects(syncDatabasePages('docs', view('사람.md'), q), /겹칩니다/)
  assert.equal(fs.readFileSync(path.join(root, '사람.md'), 'utf8'), '# 사람')
  assert.deepEqual(fs.readdirSync(path.join(root, '사람')), [])
}))

test('row filenames keep natural names and neutralize path separators and reserved names', () => {
  assert.equal(rowPageName('송상훈'), '송상훈')
  assert.equal(rowPageName('../../경로'), '페이지 .. .. 경로')
  for (const title of ['CON', '_Books', 'MOC', 'archives', '.', '책/독서: 질문?', '😀'.repeat(100)]) {
    const name = rowPageName(title)
    assert.doesNotMatch(name, /[\\/:?]/)
    assert.ok(Buffer.byteLength(name) < 220)
    assert.ok(!name.startsWith('.') && !name.startsWith('_'))
  }
})
