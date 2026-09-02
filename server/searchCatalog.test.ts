import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WORKSPACE_ROOT } from './paths.ts'
import { createProject, deleteProject } from './projects.ts'
import {
  ensureSearchIndex,
  exactSearchCandidates,
  resetSearchIndex,
  searchIndexDatabasePath,
  waitForSearchIndex,
} from './searchCatalog.ts'
import {
  noteFileContentChanged,
  readyFileCatalog,
  reconcileFileCatalog,
  refreshFileCatalogParent,
  resetFileCatalogs,
} from './fileCatalog.ts'
import { searchInProject } from './search.ts'

const randomProject = () => `zsearch${process.pid}${Math.random().toString(36).slice(2, 7)}`

test('FTS trigram은 한글·영문 리터럴 후보를 만들고 짧은 질의는 scanner로 넘긴다', async () => {
  const project = randomProject()
  const root = path.join(WORKSPACE_ROOT, project)
  createProject(project)
  try {
    fs.writeFileSync(path.join(root, 'korean.md'), '사이드바 검색 계획을 구현한다\n')
    fs.writeFileSync(path.join(root, 'english.ts'), 'const needleValue = true\n')
    fs.writeFileSync(path.join(root, 'large.txt'), `${'x'.repeat(1_000_000)} large-tail-needle\n`)
    assert.equal(ensureSearchIndex(project, ['korean.md', 'english.ts', 'large.txt']), 'building')
    assert.equal(await waitForSearchIndex(project), 'ready')
    assert.deepEqual(exactSearchCandidates(project, '검색 계획').paths, ['korean.md'])
    assert.deepEqual(exactSearchCandidates(project, 'needle').paths, ['english.ts', 'large.txt'])
    assert.deepEqual(exactSearchCandidates(project, 'large-tail-needle').paths, ['large.txt'])
    const largeResult = searchInProject(project, ['large.txt'], 'large-tail-needle', { regex: false, caseSensitive: false })
    assert.equal(largeResult.results[0]?.matches[0]?.line, 1)
    assert.ok((largeResult.results[0]?.matches[0]?.text.length ?? 0) <= 401)
    assert.equal(exactSearchCandidates(project, '검').paths, null)
  } finally {
    resetSearchIndex()
    try { deleteProject(project) } catch { fs.rmSync(root, { recursive: true, force: true }) }
  }
})

test('증분 삭제는 특수문자 경로의 실제 하위 항목만 색인에서 제거한다', async () => {
  const project = randomProject()
  const root = path.join(WORKSPACE_ROOT, project)
  createProject(project)
  try {
    fs.mkdirSync(path.join(root, '100%_real'), { recursive: true })
    fs.mkdirSync(path.join(root, '100AAreal'), { recursive: true })
    fs.writeFileSync(path.join(root, '100%_real', 'remove.md'), 'remove-only phrase\n')
    fs.writeFileSync(path.join(root, '100AAreal', 'keep.md'), 'keep-only phrase\n')

    const snapshot = await readyFileCatalog(project)
    ensureSearchIndex(project, snapshot.files.map((node) => node.path))
    assert.equal(await waitForSearchIndex(project), 'ready')

    fs.rmSync(path.join(root, '100%_real'), { recursive: true })
    await refreshFileCatalogParent(project)
    assert.equal(await waitForSearchIndex(project), 'ready')
    assert.deepEqual(exactSearchCandidates(project, 'remove-only').paths, [])
    assert.deepEqual(exactSearchCandidates(project, 'keep-only').paths, ['100AAreal/keep.md'])

    fs.mkdirSync(path.join(root, 'new%_dir'), { recursive: true })
    fs.writeFileSync(path.join(root, 'new%_dir', 'added.md'), 'added-only phrase\n')
    await refreshFileCatalogParent(project)
    assert.equal(await waitForSearchIndex(project), 'ready')
    assert.deepEqual(exactSearchCandidates(project, 'added-only').paths, ['new%_dir/added.md'])

    fs.renameSync(path.join(root, 'new%_dir', 'added.md'), path.join(root, 'new%_dir', 'renamed.md'))
    await refreshFileCatalogParent(project, 'new%_dir')
    assert.equal(await waitForSearchIndex(project), 'ready')
    assert.deepEqual(exactSearchCandidates(project, 'added-only').paths, ['new%_dir/renamed.md'])

    fs.writeFileSync(path.join(root, '100AAreal', 'keep.md'), 'updated-only phrase\n')
    noteFileContentChanged(project, '100AAreal/keep.md')
    assert.equal(await waitForSearchIndex(project), 'ready')
    assert.deepEqual(exactSearchCandidates(project, 'keep-only').paths, [])
    assert.deepEqual(exactSearchCandidates(project, 'updated-only').paths, ['100AAreal/keep.md'])

    fs.mkdirSync(path.join(root, 'missed', 'deep'), { recursive: true })
    fs.writeFileSync(path.join(root, 'missed', 'deep', 'reconciled.md'), 'reconciled-only phrase\n')
    assert.equal(await reconcileFileCatalog(project), true)
    assert.equal(await waitForSearchIndex(project), 'ready')
    assert.deepEqual(exactSearchCandidates(project, 'reconciled-only').paths, ['missed/deep/reconciled.md'])
  } finally {
    resetFileCatalogs()
    resetSearchIndex()
    try { deleteProject(project) } catch { fs.rmSync(root, { recursive: true, force: true }) }
  }
})

test('손상된 파생 DB는 원문에서 자동 재구축하고 파일 권한을 제한한다', async () => {
  const project = randomProject()
  const root = path.join(WORKSPACE_ROOT, project)
  createProject(project)
  try {
    fs.writeFileSync(path.join(root, 'recover.md'), 'recoverable phrase\n')
    const databasePath = searchIndexDatabasePath()
    resetSearchIndex()
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    fs.writeFileSync(databasePath, 'not a sqlite database')

    assert.equal(ensureSearchIndex(project, ['recover.md']), 'building')
    assert.equal(await waitForSearchIndex(project), 'ready')
    assert.deepEqual(exactSearchCandidates(project, 'recoverable').paths, ['recover.md'])
    if (process.platform !== 'win32') assert.equal(fs.statSync(databasePath).mode & 0o777, 0o600)

    resetSearchIndex()
    const oldSchema = new DatabaseSync(databasePath)
    oldSchema.prepare("UPDATE search_meta SET value='0' WHERE key='schema_version'").run()
    oldSchema.close()
    assert.equal(ensureSearchIndex(project, ['recover.md']), 'building')
    assert.equal(await waitForSearchIndex(project), 'ready')
    assert.deepEqual(exactSearchCandidates(project, 'recoverable').paths, ['recover.md'])

    resetSearchIndex()
    fs.rmSync(databasePath, { force: true })
    assert.equal(ensureSearchIndex(project, ['recover.md']), 'building')
    assert.equal(await waitForSearchIndex(project), 'ready')
    assert.deepEqual(exactSearchCandidates(project, 'recoverable').paths, ['recover.md'])
  } finally {
    resetSearchIndex()
    try { deleteProject(project) } catch { fs.rmSync(root, { recursive: true, force: true }) }
  }
})

test('색인 flag를 끄면 scanner fallback 상태를 돌려준다', () => {
  const previous = process.env.MEW_SEARCH_INDEX_ENABLED
  try {
    process.env.MEW_SEARCH_INDEX_ENABLED = '0'
    resetSearchIndex()
    assert.equal(ensureSearchIndex('does-not-open', []), 'disabled')
    assert.deepEqual(exactSearchCandidates('does-not-open', 'literal'), {
      state: 'disabled',
      paths: null,
      dirtyPaths: [],
    })
  } finally {
    if (previous === undefined) delete process.env.MEW_SEARCH_INDEX_ENABLED
    else process.env.MEW_SEARCH_INDEX_ENABLED = previous
    resetSearchIndex()
  }
})
