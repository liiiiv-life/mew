import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { WORKSPACE_ROOT } from './paths.ts'
import { createProject, deleteProject } from './projects.ts'
import {
  listCatalogChildren,
  listCatalogFiles,
  readyFileCatalog,
  refreshFileCatalogParent,
  resetFileCatalogs,
} from './fileCatalog.ts'

const randomProject = () => `zcat${process.pid}${Math.random().toString(36).slice(2, 7)}`

test('FileCatalog은 전체 scan을 공유하고 영향 부모만 새 snapshot으로 바꾼다', async () => {
  const project = randomProject()
  const root = path.join(WORKSPACE_ROOT, project)
  createProject(project)
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.mkdirSync(path.join(root, 'other'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1\n')
    fs.writeFileSync(path.join(root, 'other', 'keep.ts'), 'export {}\n')

    const [first, second] = await Promise.all([readyFileCatalog(project), readyFileCatalog(project)])
    assert.equal(first, second, '동시 최초 요청은 같은 build promise와 snapshot을 공유한다')
    assert.ok((await listCatalogFiles(project, { showAll: true })).some((node) => node.path === 'src/a.ts'))

    fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export const b = 2\n')
    await refreshFileCatalogParent(project, 'src')
    const src = await listCatalogChildren(project, 'src', { showAll: true })
    assert.deepEqual(src.entries.map((node) => node.path), ['src/a.ts', 'src/b.ts'])
    const other = await listCatalogChildren(project, 'other', { showAll: true })
    assert.deepEqual(other.entries.map((node) => node.path), ['other/keep.ts'])
    assert.ok(src.version > first.version)
    assert.equal(await refreshFileCatalogParent(project, 'src'), false, '구조가 같으면 version을 올리지 않는다')
    assert.equal((await listCatalogChildren(project, 'src', { showAll: true })).version, src.version)
  } finally {
    resetFileCatalogs()
    try { deleteProject(project) } catch { fs.rmSync(root, { recursive: true, force: true }) }
  }
})

test('FileCatalog의 member view는 showAll snapshot에서도 트리 정책을 다시 적용한다', async () => {
  const project = randomProject()
  const root = path.join(WORKSPACE_ROOT, project)
  createProject(project)
  try {
    fs.writeFileSync(path.join(root, 'visible.ts'), 'export {}\n')
    fs.writeFileSync(path.join(root, 'hidden.zip'), 'zip')
    await readyFileCatalog(project)
    const member = await listCatalogChildren(project)
    const owner = await listCatalogChildren(project, '', { showAll: true })
    assert.ok(member.entries.some((node) => node.path === 'visible.ts'))
    assert.ok(!member.entries.some((node) => node.path === 'hidden.zip'))
    assert.ok(owner.entries.some((node) => node.path === 'hidden.zip'))
  } finally {
    resetFileCatalogs()
    try { deleteProject(project) } catch { fs.rmSync(root, { recursive: true, force: true }) }
  }
})
