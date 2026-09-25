import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  deleteExternalPath,
  createExternalFolder,
  createExternalDirectory,
  MissingDirectoryError,
  listEntries,
  pasteExternalPath,
  readExternalFile,
  renameExternalPath,
  writeExternalFile,
} from './fsBrowse.ts'

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-fs-browse-'))
  fs.mkdirSync(path.join(root, '.hidden'))
  fs.mkdirSync(path.join(root, 'folder'))
  fs.writeFileSync(path.join(root, 'note.txt'), 'hello')
  return root
}

test('missing paths identify the nearest existing directory and create the complete requested path', async () => {
  const root = fixture()
  try {
    const target = path.join(root, 'folder', '새 경로', 'project')
    await assert.rejects(listEntries(target), (err: unknown) => {
      assert.ok(err instanceof MissingDirectoryError)
      assert.deepEqual(err.missing, { path: target, existingPath: path.join(root, 'folder'), missingName: '새 경로' })
      return true
    })
    assert.equal(fs.existsSync(target), false, 'inspection never creates directories')
    assert.equal(await createExternalDirectory(target), target)
    assert.equal((await listEntries(target)).path, target)
    assert.equal(await createExternalDirectory(target), target, 'another client may already have created it')
    await assert.rejects(createExternalDirectory(''))
    await assert.rejects(createExternalDirectory(path.join(root, 'note.txt', 'child')))
    fs.symlinkSync(path.join(root, 'missing-target'), path.join(root, 'broken'))
    for (const invalid of ['note.txt', 'note.txt/child', 'broken', 'broken/child']) {
      await assert.rejects(listEntries(path.join(root, invalid)), err => !(err instanceof MissingDirectoryError))
    }
    await assert.rejects(createExternalDirectory(path.join(root, 'broken', 'child')))
    assert.equal(fs.existsSync(path.join(root, 'missing-target')), false)
    if (process.getuid?.() !== 0) {
      const denied = path.join(root, 'denied')
      fs.mkdirSync(denied, { mode: 0o000 })
      try { await assert.rejects(listEntries(path.join(denied, 'child')), err => !(err instanceof MissingDirectoryError)) }
      finally { fs.chmodSync(denied, 0o700) }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('listEntries는 숨김 항목을 포함하고 폴더를 파일보다 먼저 정렬한다', async () => {
  const root = fixture()
  try {
    const result = await listEntries(root)
    assert.equal(result.path, root)
    assert.deepEqual(result.entries.map((entry) => [entry.name, entry.type]), [
      ['.hidden', 'dir'],
      ['folder', 'dir'],
      ['note.txt', 'file'],
    ])
    fs.symlinkSync(path.join(root, 'folder'), path.join(root, 'alias'))
    const alias = await listEntries(path.join(root, 'alias'))
    assert.equal(alias.path, path.join(root, 'alias'))
    assert.equal(alias.canonicalPath, fs.realpathSync(path.join(root, 'folder')))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('외부 파일 읽기·저장·개명·복사·이동·삭제가 절대경로에서 동작한다', () => {
  const root = fixture()
  try {
    const note = path.join(root, 'note.txt')
    assert.equal(readExternalFile(note).content, 'hello')
    writeExternalFile(note, 'changed')
    assert.equal(fs.readFileSync(note, 'utf8'), 'changed')

    const renamed = renameExternalPath(note, 'renamed.txt')
    const copied = pasteExternalPath(renamed, path.join(root, 'folder'), 'copy')
    assert.equal(fs.readFileSync(copied, 'utf8'), 'changed')
    assert.equal(fs.existsSync(renamed), true)

    const moved = pasteExternalPath(renamed, path.join(root, '.hidden'), 'cut')
    assert.equal(fs.existsSync(renamed), false)
    assert.equal(fs.readFileSync(moved, 'utf8'), 'changed')
    deleteExternalPath(moved)
    assert.equal(fs.existsSync(moved), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('프로젝트 브라우저는 새 폴더를 만들고 Git 저장소를 표시한다', async () => {
  const root = fixture()
  try {
    const created = createExternalFolder(root, 'new-project')
    assert.equal(created, path.join(root, 'new-project'))
    fs.mkdirSync(path.join(created, '.git'))
    const result = await listEntries(root)
    assert.equal(result.entries.find((entry) => entry.name === 'new-project')?.git, true)
    assert.throws(() => createExternalFolder(root, '../escape'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
