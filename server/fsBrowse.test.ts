import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  deleteExternalPath,
  createExternalFolder,
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
