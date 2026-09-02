import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setWorkspaceRoot, WORKSPACE_ROOT } from './paths.ts'
import { createProject, deleteProject } from './projects.ts'
import { createSearchPerfFixture } from './perfFixture.ts'
import { listCatalogFiles, readyFileCatalog, resetFileCatalogs } from './fileCatalog.ts'
import { rankFileNamePaths } from './fileNameSearch.ts'
import { ensureSearchIndex, exactSearchCandidates, resetSearchIndex, waitForSearchIndex } from './searchCatalog.ts'
import { searchInProject } from './search.ts'

test('1만 파일 fixture도 catalog 한 번 뒤 Ctrl+P 후보를 50개로 제한한다', async () => {
  const originalWorkspace = WORKSPACE_ROOT
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-perf-workspace-')))
  setWorkspaceRoot(workspace)
  const project = `zperf${process.pid}${Math.random().toString(36).slice(2, 7)}`
  const root = path.join(workspace, project)
  createProject(project)
  try {
    createSearchPerfFixture(root)
    await readyFileCatalog(project)
    const files = await listCatalogFiles(project)
    assert.equal(files.length, 10_000)
    const results = rankFileNamePaths('SearchPanel', files.map((node) => node.path), { regex: false, caseSensitive: false })
    assert.equal(results.length, 50)

    const paths = files.map((node) => node.path)
    ensureSearchIndex(project, paths)
    assert.equal(await waitForSearchIndex(project), 'ready')
    const candidates = exactSearchCandidates(project, 'needle-3999').paths
    assert.deepEqual(candidates, ['scope-0039/module-3999.ts'])
    const indexed = searchInProject(project, candidates ?? [], 'needle-3999', { regex: false, caseSensitive: false })
    const scanned = searchInProject(project, paths, 'needle-3999', { regex: false, caseSensitive: false })
    assert.deepEqual(indexed.results, scanned.results)
    assert.equal(indexed.truncated, false)
    assert.equal(scanned.truncated, true, '기존 scanner는 4천 파일 상한을 명시한다')
  } finally {
    resetFileCatalogs()
    resetSearchIndex()
    try { deleteProject(project) } catch { fs.rmSync(root, { recursive: true, force: true }) }
    setWorkspaceRoot(originalWorkspace)
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})
