// docs 폴더 가져오기·내보내기 — 진짜 docs를 건드리지 않도록 임시 폴더를 docsRoot로 넣어 검증한다.
// 가져오기는 되돌릴 수 없는 삭제를 포함하므로, 자기 자신을 품는 경로는 지우기 **전에** 막아야 한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DocsRepoError, exportDocs, importDocs } from './docsRepo.ts'

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mew-docs-'))
}

test('importDocs: 기존 내용을 지우고 외부 폴더로 채운다', () => {
  const base = tmp()
  try {
    const docsRoot = path.join(base, '.mew', 'docs')
    fs.mkdirSync(docsRoot, { recursive: true })
    fs.writeFileSync(path.join(docsRoot, 'old.md'), 'old', 'utf-8')
    const src = path.join(base, 'incoming')
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(src, 'sub', 'new.md'), 'new', 'utf-8')

    importDocs(src, docsRoot)
    assert.ok(!fs.existsSync(path.join(docsRoot, 'old.md')), '기존 내용은 사라져야 한다')
    assert.equal(fs.readFileSync(path.join(docsRoot, 'sub', 'new.md'), 'utf-8'), 'new')
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('importDocs: 없는 폴더와 자기 자신을 품는 경로는 거부한다', () => {
  const base = tmp()
  try {
    const docsRoot = path.join(base, '.mew', 'docs')
    fs.mkdirSync(docsRoot, { recursive: true })
    fs.writeFileSync(path.join(docsRoot, 'keep.md'), 'keep', 'utf-8')

    assert.throws(() => importDocs(path.join(base, 'nope'), docsRoot), DocsRepoError)
    assert.throws(() => importDocs(docsRoot, docsRoot), DocsRepoError)
    assert.throws(() => importDocs(base, docsRoot), DocsRepoError) // 상위 폴더
    assert.ok(fs.existsSync(path.join(docsRoot, 'keep.md')), '거부된 요청은 아무것도 지우지 않아야 한다')
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('exportDocs: 대상 폴더 아래 docs로 복사하고 이미 있으면 거부한다', () => {
  const base = tmp()
  try {
    const docsRoot = path.join(base, '.mew', 'docs')
    fs.mkdirSync(docsRoot, { recursive: true })
    fs.writeFileSync(path.join(docsRoot, 'a.md'), 'a', 'utf-8')
    const out = path.join(base, 'out')
    fs.mkdirSync(out)

    const dest = exportDocs(out, docsRoot)
    assert.equal(dest, path.join(out, 'docs'))
    assert.equal(fs.readFileSync(path.join(dest, 'a.md'), 'utf-8'), 'a')
    assert.throws(() => exportDocs(out, docsRoot), /이미 있는 폴더/)
    assert.throws(() => exportDocs(path.join(base, 'nope'), docsRoot), DocsRepoError)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})
