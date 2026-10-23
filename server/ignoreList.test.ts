// 숨김 목록은 설정 창에서 아무나(owner/manager) 고치는 값이라, 저장 전 정규화가 유일한 방어선이다.
// 특히 경로 형태(`a/b`·`..`)가 통과하면 "이름 비교"라는 전제가 깨지고, 차단 경로(.git 등)가 목록에서
// 빠지면 UI가 "지웠다"고 보여주지만 서버는 계속 막아 화면과 실제가 어긋난다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-ignore-'))
process.env.MEW_DATA_DIR = dir

const { DEFAULT_IGNORE, IgnoreListError, LOCKED_IGNORE, normalizeIgnoreList, readIgnoreList, readIgnoreSet, writeIgnoreList } =
  await import('./ignoreList.ts')
const IGNORE_FILE = path.join(dir, 'ignore.json')

test('readIgnoreList: 저장된 게 없으면 기본 목록', () => {
  fs.rmSync(IGNORE_FILE, { force: true })
  assert.deepEqual(readIgnoreList(), DEFAULT_IGNORE)
})

test('writeIgnoreList: 저장한 목록이 그대로 읽히고 캐시도 따라온다', () => {
  writeIgnoreList(['dist', 'coverage', ...LOCKED_IGNORE])
  assert.ok(readIgnoreSet().has('coverage'))
  assert.deepEqual(JSON.parse(fs.readFileSync(IGNORE_FILE, 'utf-8')).names, ['dist', 'coverage', ...LOCKED_IGNORE])
})

test('normalizeIgnoreList: 차단 경로는 빼도 되돌아오고 중복은 하나로', () => {
  const names = normalizeIgnoreList(['dist', 'dist', 'coverage'])
  assert.deepEqual(names.filter((n) => n === 'dist'), ['dist'])
  for (const locked of LOCKED_IGNORE) assert.ok(names.includes(locked), `${locked}는 되돌아와야 한다`)
})

test('normalizeIgnoreList: 경로·빈 값·배열 아님은 거부', () => {
  for (const bad of ['a/b', 'a\\b', '..', '.', '  ']) {
    assert.throws(() => normalizeIgnoreList([bad]), IgnoreListError, `거부해야 한다: ${JSON.stringify(bad)}`)
  }
  assert.throws(() => normalizeIgnoreList('dist'), IgnoreListError)
  assert.throws(() => normalizeIgnoreList([42]), IgnoreListError)
})

test('normalizeIgnoreList: 앞뒤 공백은 다듬는다', () => {
  assert.ok(normalizeIgnoreList([' coverage ']).includes('coverage'))
})
