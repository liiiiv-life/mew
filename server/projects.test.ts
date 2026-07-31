// 프로젝트 폴더 생성·개명·삭제 — 실제 파일시스템(WORKSPACE_ROOT)에 임시 폴더를 만들어 검증하고
// 끝나면 지운다. 보호된 프로젝트(docs·앱 자신)와 잘못된 이름은 거부해야 한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { WORKSPACE_ROOT } from './paths.ts'
import { createProject, deleteProject, ProjectNameError, renameProject } from './projects.ts'

const rand = () => `ztest${process.pid}${Math.random().toString(36).slice(2, 6)}`

test('createProject: 새 폴더를 만들고 중복·잘못된 이름은 거부한다', () => {
  const name = rand()
  const dir = path.join(WORKSPACE_ROOT, name)
  try {
    createProject(name)
    assert.ok(fs.existsSync(dir) && fs.statSync(dir).isDirectory(), '폴더가 생겨야 한다')
    assert.throws(() => createProject(name), /이미 존재/)
    assert.throws(() => createProject('../evil'), ProjectNameError)
    assert.throws(() => createProject('.git'), ProjectNameError)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('renameProject: 폴더 이름을 바꾸고 보호된 프로젝트는 거부한다', () => {
  const a = rand()
  const b = rand()
  const dirA = path.join(WORKSPACE_ROOT, a)
  const dirB = path.join(WORKSPACE_ROOT, b)
  try {
    createProject(a)
    fs.writeFileSync(path.join(dirA, 'x.md'), '# hi\n', 'utf-8')
    renameProject(a, b)
    assert.ok(!fs.existsSync(dirA), '옛 폴더는 사라져야 한다')
    assert.ok(fs.existsSync(path.join(dirB, 'x.md')), '내용이 새 폴더로 옮겨져야 한다')
    assert.throws(() => renameProject('docs', rand()), ProjectNameError)
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true })
    fs.rmSync(dirB, { recursive: true, force: true })
  }
})

test('deleteProject: 폴더를 통째로 지우고 보호된 프로젝트는 거부한다', () => {
  const name = rand()
  const dir = path.join(WORKSPACE_ROOT, name)
  createProject(name)
  fs.writeFileSync(path.join(dir, 'x.md'), '# hi\n', 'utf-8')
  deleteProject(name)
  assert.ok(!fs.existsSync(dir), '폴더가 완전히 사라져야 한다')
  assert.throws(() => deleteProject('docs'), ProjectNameError)
})
