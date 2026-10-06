import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_MEWCAT_FUR_COLOR, MEWCAT_FUR_COLOR_KEY, loadMewcatFurColor, saveMewcatFurColor, mewcatFurPalette, normalizeMewcatFurColor } from './mewcat-fur-color.ts'
test('fur color stores valid HEX, restores it and recovers from invalid or blocked storage', () => {
  let stored: string | null = null
  const storage = { getItem: (key: string) => { assert.equal(key, MEWCAT_FUR_COLOR_KEY); return stored }, setItem: (key: string, value: string) => { assert.equal(key, MEWCAT_FUR_COLOR_KEY); stored = value } }
  assert.equal(loadMewcatFurColor(storage), DEFAULT_MEWCAT_FUR_COLOR)
  assert.equal(saveMewcatFurColor('#ABCDEF', storage), '#abcdef')
  assert.equal(loadMewcatFurColor(storage), '#abcdef')
  for (const invalid of ['#fff', 'red', '#gggggg', 'url(test)', null, 42]) assert.equal(normalizeMewcatFurColor(invalid), DEFAULT_MEWCAT_FUR_COLOR)
  assert.equal(saveMewcatFurColor('#ffffff', { setItem() { throw new Error('blocked') } }), '#ffffff')
  assert.equal(loadMewcatFurColor({ getItem() { throw new Error('blocked') } }), DEFAULT_MEWCAT_FUR_COLOR)
})
test('light fur keeps facial features visible and the default black cat keeps its palette', () => {
  const black = mewcatFurPalette(DEFAULT_MEWCAT_FUR_COLOR), white = mewcatFurPalette('#ffffff')
  assert.equal(black['--mewcat-ink'], '#e8d99b')
  assert.equal(black['--mewcat-outline'], '#737373')
  assert.equal(black['--mewcat-stripe'], '#353535')
  assert.equal(white['--mewcat-ink'], '#171717')
  assert.equal(white['--mewcat-outline'], '#4b4b4b')
  assert.equal(mewcatFurPalette('#ff00aa')['--mewcat-fur'], '#ff00aa')
})
