import assert from 'node:assert/strict'
import test from 'node:test'
import { MEWCAT_SKIN_KEY, loadMewcatSkin, normalizeMewcatSkin, saveMewcatSkin } from './mewcatSkin.ts'

test('Mewcat 기본·옛 oreo 선택은 실루엣의 mew ID로 이어받는다', () => {
  assert.equal(loadMewcatSkin({ getItem: () => null }), 'mew')
  assert.equal(loadMewcatSkin({ getItem: () => 'mew' }), 'mew')
  assert.equal(loadMewcatSkin({ getItem: () => 'oreo' }), 'mew')
})

test('Mewcat 스킨 선택은 허용 목록만 저장하고 없음은 명시적으로 남긴다', () => {
  assert.equal(normalizeMewcatSkin('unknown'), null)
  assert.equal(normalizeMewcatSkin('kitten'), 'kitten')
  assert.equal(normalizeMewcatSkin('custom:my-kitten'), 'custom:my-kitten')
  assert.equal(normalizeMewcatSkin('custom:../../other'), null)
  let saved: [string, string] | null = null
  assert.equal(saveMewcatSkin(null, { setItem: (key, value) => { saved = [key, value] } }), null)
  assert.deepEqual(saved, [MEWCAT_SKIN_KEY, 'none'])
})
