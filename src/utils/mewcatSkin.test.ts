import assert from 'node:assert/strict'
import test from 'node:test'
import { MEWCAT_SKIN_KEY, loadMewcatSkin, normalizeMewcatSkin, saveMewcatSkin } from './mewcatSkin.ts'

test('Mewcat은 저장값이 없으면 기존 기본 스킨을 유지한다', () => {
  assert.equal(loadMewcatSkin({ getItem: () => null }), 'oreo')
})

test('Mewcat 스킨 선택은 허용 목록만 저장하고 없음은 명시적으로 남긴다', () => {
  assert.equal(normalizeMewcatSkin('unknown'), null)
  let saved: [string, string] | null = null
  assert.equal(saveMewcatSkin(null, { setItem: (key, value) => { saved = [key, value] } }), null)
  assert.deepEqual(saved, [MEWCAT_SKIN_KEY, 'none'])
})
