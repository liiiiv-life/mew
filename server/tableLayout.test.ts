// 표 열 너비 저장(.mew/table-layout.json) — 임시 프로젝트 폴더에서 왕복·정규화를 검증한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { WORKSPACE_ROOT } from './paths.ts'
import { createProject, deleteProject } from './projects.ts'
import { readTableLayout, TableLayoutError, writeTableLayout } from './tableLayout.ts'

const rand = () => `ztest${process.pid}${Math.random().toString(36).slice(2, 6)}`

function withProject(fn: (name: string, dir: string) => void) {
  const name = rand()
  const dir = path.join(WORKSPACE_ROOT, name)
  createProject(name)
  try {
    fn(name, dir)
  } finally {
    try {
      deleteProject(name)
    } catch {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

test('writeTableLayout: 저장한 너비를 그대로 다시 읽는다', () => {
  withProject((name, dir) => {
    writeTableLayout(name, 'docs/a.md', [[120, 80], null, [90, 90, 90]])
    assert.deepEqual(readTableLayout(name, 'docs/a.md'), [[120, 80], null, [90, 90, 90]])
    assert.ok(fs.existsSync(path.join(dir, '.mew', 'table-layout.json')))
  })
})

test('writeTableLayout: 문서마다 따로 저장되고 서로 덮어쓰지 않는다', () => {
  withProject((name) => {
    writeTableLayout(name, 'a.md', [[100, 100]])
    writeTableLayout(name, 'b.md', [[200]])
    assert.deepEqual(readTableLayout(name, 'a.md'), [[100, 100]])
    assert.deepEqual(readTableLayout(name, 'b.md'), [[200]])
  })
})

test('readTableLayout: 저장된 적 없는 문서는 빈 배열', () => {
  withProject((name) => {
    assert.deepEqual(readTableLayout(name, '없는문서.md'), [])
  })
})

test('writeTableLayout: 빈 값이면 항목을 지운다', () => {
  withProject((name) => {
    writeTableLayout(name, 'a.md', [[100, 100]])
    writeTableLayout(name, 'a.md', [])
    assert.deepEqual(readTableLayout(name, 'a.md'), [])
  })
})

test('writeTableLayout: 0(조절 안 한 열)은 남기고, 전부 0인 표는 null로 접는다', () => {
  withProject((name) => {
    writeTableLayout(name, 'a.md', [[0, 140], [0, 0]])
    assert.deepEqual(readTableLayout(name, 'a.md'), [[0, 140]]) // 뒤쪽 null은 잘린다
  })
})

test('writeTableLayout: 범위를 벗어나거나 숫자가 아닌 값은 그 표만 버린다', () => {
  withProject((name) => {
    writeTableLayout(name, 'a.md', [['넓게'], [999999], [110, 110]])
    assert.deepEqual(readTableLayout(name, 'a.md'), [null, null, [110, 110]])
  })
})

test('writeTableLayout: 경로가 비면 던진다', () => {
  withProject((name) => {
    assert.throws(() => writeTableLayout(name, '', [[100]]), TableLayoutError)
  })
})

test('readTableLayout: 깨진 JSON은 "저장된 것 없음"으로 다룬다', () => {
  withProject((name, dir) => {
    const mew = path.join(dir, '.mew')
    fs.mkdirSync(mew, { recursive: true })
    fs.writeFileSync(path.join(mew, 'table-layout.json'), '{ 깨진', 'utf-8')
    assert.deepEqual(readTableLayout(name, 'a.md'), [])
  })
})
