// 프로젝트 아이콘이 "가끔 통째로 초기화되던" 문제를 막는 회귀 테스트.
// 원인은 읽기 실패를 조용히 빈 객체로 넘기고, 그 위에 통째로 덮어쓴 것 — 다른 프로세스가
// 저장하는 순간(0바이트 구간)에 읽으면 남아 있던 아이콘이 전부 사라졌다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-icons-'))
process.env.MEW_DATA_DIR = dir

const { readProjectIcons, setProjectIcon } = await import('./projectIcons.ts')
const ICONS_FILE = path.join(dir, 'project-icons.json')

test('setProjectIcon: 설정·삭제가 저장되고 다른 프로젝트는 남는다', () => {
  fs.rmSync(ICONS_FILE, { force: true })
  setProjectIcon('alpha', 'i:book')
  setProjectIcon('beta', '🌱')
  assert.deepEqual(readProjectIcons(), { alpha: 'i:book', beta: '🌱' })

  setProjectIcon('beta', null)
  assert.deepEqual(readProjectIcons(), { alpha: 'i:book' })
})

test('setProjectIcon: 저장 중에도 파일이 빈 적이 없다 (원자적 교체)', () => {
  fs.rmSync(ICONS_FILE, { force: true })
  setProjectIcon('alpha', 'i:book')
  // rename으로 갈아끼우므로 임시 파일이 남지 않고, 경로는 항상 완전한 JSON을 가리킨다
  assert.deepEqual(JSON.parse(fs.readFileSync(ICONS_FILE, 'utf-8')), { alpha: 'i:book' })
  assert.equal(
    fs.readdirSync(dir).filter((f) => f.includes('.tmp-')).length,
    0,
  )
})

test('setProjectIcon: 파일이 깨져 있으면 덮어쓰지 않고 사본을 남긴 뒤 실패한다', () => {
  fs.writeFileSync(ICONS_FILE, '{"alpha": "i:book"', 'utf-8') // 잘린 JSON
  assert.throws(() => setProjectIcon('gamma', 'i:star'), /깨졌습니다/)

  // 원본은 그대로 — 손으로 되살릴 수 있다
  assert.equal(fs.readFileSync(ICONS_FILE, 'utf-8'), '{"alpha": "i:book"')
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('project-icons.json.corrupt-')))
  // 반면 목록 조회는 실패하지 않는다 (아이콘 없이 보일 뿐)
  assert.deepEqual(readProjectIcons(), {})
})

test('setProjectIcon: 없는 아이콘을 지우는 건 파일을 건드리지 않는다', () => {
  fs.rmSync(ICONS_FILE, { force: true })
  setProjectIcon('alpha', null)
  assert.equal(fs.existsSync(ICONS_FILE), false)
})
