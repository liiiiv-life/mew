// CodePane(plain 모드)의 Ctrl+F 배선 — md뿐 아니라 코드·csv 등 텍스트 파일 전부에 붙어야 한다.
// 실제 패널 DOM은 CodeMirror 몫이라, 여기서는 상태에 검색 확장이 실려 있는지만 본다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { codeSearchExtensions } from './codeSearch.ts'

const state = EditorState.create({ doc: 'a,b,c\n1,2,3\n', extensions: codeSearchExtensions })

test('Ctrl+F가 찾기 패널에 매여 있다', () => {
  const keys = state.facet(keymap).flat().map((b) => b.key)
  assert.ok(keys.includes('Mod-f'), `Mod-f 바인딩 없음: ${keys.join(' ')}`)
})

test('패널 문구가 한국어다', () => {
  assert.equal(state.phrase('Find'), '찾기')
  assert.equal(state.phrase('replace all'), '모두 바꾸기')
})
