import assert from 'node:assert/strict'
import test from 'node:test'
import { MEWCAT_SKIN_KEY, loadMewcatSkin, normalizeMewcatSkin, saveMewcatSkin } from './mewcatSkin.ts'

test('Mewcat 기본·옛 oreo 선택은 실루엣의 mew ID로 이어받는다', () => {
  assert.equal(loadMewcatSkin({ getItem: () => null }), 'mew')
  assert.equal(loadMewcatSkin({ getItem: () => 'mew' }), 'mew')
  assert.equal(loadMewcatSkin({ getItem: () => 'oreo' }), 'mew')
})

test('Mewcat 스킨 선택은 유효한 파일 스킨 ID를 저장하고 없음은 명시적으로 남긴다', () => {
  assert.equal(normalizeMewcatSkin('file-pet'), 'file-pet')
  assert.equal(normalizeMewcatSkin('../invalid'), null)
  assert.equal(normalizeMewcatSkin('kitten'), 'kitten')
  assert.equal(normalizeMewcatSkin('custom:my-kitten'), 'custom:my-kitten')
  assert.equal(normalizeMewcatSkin('custom:../../other'), null)
  let saved: [string, string] | null = null
  assert.equal(saveMewcatSkin(null, { setItem: (key, value) => { saved = [key, value] } }), null)
  assert.deepEqual(saved, [MEWCAT_SKIN_KEY, 'none'])
})

test('추가 동물 스킨의 선택은 각 ID를 저장하고 그대로 복원한다', () => {
  for (const id of ['russian-blue', 'korean-shorthair', 'capybara'] as const) {
    let saved = ''
    assert.equal(normalizeMewcatSkin(id), id)
    assert.equal(saveMewcatSkin(id, { setItem: (_key, value) => { saved = value } }), id)
    assert.equal(loadMewcatSkin({ getItem: () => saved }), id)
  }
})
