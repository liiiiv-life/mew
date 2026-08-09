// 할 일 표식 파싱과 되쓰기. 표식을 소스에 리터럴로 적지 않고 mark()로 조립하는 것은 일부러다 —
// 적으면 **이 테스트 파일 자체가** 워크스페이스 스캔 결과에 항목으로 잡힌다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { formatMarker, parseMarkerBody, scanContent, TodoError, updateTodo } from './todos.ts'

function mark(tag: 'TODO' | 'DONE', body: string): string {
  return `[${tag}:${body}]`
}

test('parseMarkerBody: 맨 뒤 @날짜만 기한으로 떼어낸다', () => {
  assert.deepEqual(parseMarkerBody('라벨 정렬'), { text: '라벨 정렬', due: null })
  assert.deepEqual(parseMarkerBody('라벨 정렬 @2026-08-20'), { text: '라벨 정렬', due: '2026-08-20' })
  // 이메일·핸들처럼 가운데 있는 @는 라벨의 일부다
  assert.deepEqual(parseMarkerBody('@saens 에게 묻기'), { text: '@saens 에게 묻기', due: null })
  assert.deepEqual(parseMarkerBody('날짜 아님 @2026-8-2'), { text: '날짜 아님 @2026-8-2', due: null })
})

test('scanContent: 줄번호·완료 여부·기한을 뽑고, 백틱 예시는 건너뛴다', () => {
  const content = [
    `// ${mark('TODO', '라벨 정렬 고치기')}`,
    '',
    `// ${mark('DONE', '스캔 상한 넣기 @2026-08-20')} 뒤에 오는 말`,
    `// 형식은 \`${mark('TODO', '설명용 예시')}\` 처럼 쓴다`,
    `// ${mark('TODO', '')} 빈 표식`,
  ].join('\n')

  const items = scanContent('mew', 'server/x.ts', content)
  assert.deepEqual(
    items.map((i) => [i.line, i.text, i.done, i.due]),
    [
      [1, '라벨 정렬 고치기', false, null],
      [3, '스캔 상한 넣기', true, '2026-08-20'],
    ],
  )
  assert.equal(items[0].project, 'mew')
  assert.equal(items[0].path, 'server/x.ts')
})

test('updateTodo: 체크와 기한을 그 줄에만 되쓴다', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-todos-'))
  const rel = 'a.ts'
  const abs = path.join(base, rel)
  const resolve = () => abs
  try {
    fs.writeFileSync(abs, [`x ${mark('TODO', '첫째')}`, `y ${mark('TODO', '둘째')}`].join('\n'), 'utf-8')

    const done = updateTodo({ project: 'p', path: rel, line: 2, text: '둘째' }, { done: true }, resolve)
    assert.equal(done.done, true)
    assert.deepEqual(fs.readFileSync(abs, 'utf-8').split('\n'), [`x ${mark('TODO', '첫째')}`, `y ${mark('DONE', '둘째')}`])

    updateTodo({ project: 'p', path: rel, line: 2, text: '둘째' }, { due: '2026-09-01' }, resolve)
    assert.equal(fs.readFileSync(abs, 'utf-8').split('\n')[1], `y ${mark('DONE', '둘째 @2026-09-01')}`)

    // 기한 지우기 = null
    updateTodo({ project: 'p', path: rel, line: 2, text: '둘째' }, { due: null }, resolve)
    assert.equal(fs.readFileSync(abs, 'utf-8').split('\n')[1], `y ${mark('DONE', '둘째')}`)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('updateTodo: 라벨이 안 맞거나 형식이 틀리면 파일을 건드리지 않는다', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-todos-'))
  const abs = path.join(base, 'a.ts')
  const resolve = () => abs
  const original = `x ${mark('TODO', '첫째')}`
  try {
    fs.writeFileSync(abs, original, 'utf-8')
    assert.throws(() => updateTodo({ project: 'p', path: 'a.ts', line: 1, text: '없는것' }, { done: true }, resolve), TodoError)
    assert.throws(() => updateTodo({ project: 'p', path: 'a.ts', line: 9, text: '첫째' }, { done: true }, resolve), TodoError)
    assert.throws(() => updateTodo({ project: 'p', path: 'a.ts', line: 1, text: '첫째' }, { due: '내일' }, resolve), TodoError)
    assert.equal(fs.readFileSync(abs, 'utf-8'), original)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('formatMarker: 기한이 없으면 @도 없다', () => {
  assert.equal(formatMarker(false, '라벨', null), mark('TODO', '라벨'))
  assert.equal(formatMarker(true, '라벨', '2026-08-20'), mark('DONE', '라벨 @2026-08-20'))
})
