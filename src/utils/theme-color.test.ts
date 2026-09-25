import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DEFAULT_THEME_COLOR, THEME_COLOR_KEY, applyThemeColor, deriveThemeColors, loadThemeColor, normalizeThemeColor, saveThemeColor } from './theme-color.ts'

function luminance(hex: string) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
}
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)

test('one theme color loads, migrates the old accent and saves without derived overrides', () => {
  const values = new Map<string, string>([['mew:accent-color', JSON.stringify({ accent: '#AABBCC', accentStrong: '#000000', link: '#ffffff' })]])
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  assert.equal(loadThemeColor(storage), '#aabbcc')
  saveThemeColor('#123ABC', storage)
  assert.equal(values.get(THEME_COLOR_KEY), '#123abc')
  assert.equal(loadThemeColor(storage), '#123abc')
  assert.equal(normalizeThemeColor('red'), DEFAULT_THEME_COLOR)
  assert.equal(loadThemeColor({ getItem: () => '{broken' }), DEFAULT_THEME_COLOR)
  assert.equal(loadThemeColor({ getItem: () => { throw Error('blocked') } }), DEFAULT_THEME_COLOR)
  assert.equal(saveThemeColor('#123456', { setItem() { throw Error('full') } }), '#123456')
})

test('dark accents get brighter, light accents darker, with readable links and button labels for every hue', () => {
  const choices = [DEFAULT_THEME_COLOR, '#000000', '#ffffff', '#808080', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff']
  for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) choices.push('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''))
  for (const color of choices) for (const mode of ['dark', 'light'] as const) {
    const colors = deriveThemeColors(color, mode)
    const accent = luminance(colors.accent), strong = luminance(colors.accentStrong)
    assert.ok(mode === 'dark' ? strong > accent : strong < accent, `${mode} ${color}`)
    for (const surface of mode === 'dark' ? ['#0a0a0a', '#171717', '#262626'] : ['#ffffff', '#f5f5f5', '#e5e5e5']) {
      assert.ok(contrast(colors.accent, surface) >= 4.5, `${mode} ${color} text on ${surface}`)
      assert.ok(contrast(colors.link, surface) >= 4.5)
    }
    for (const background of [colors.accent, colors.accentStrong]) assert.ok(contrast(colors.inkOnAccent, background) >= 4.5, `${mode} ${color} button`)
  }
})

test('changing theme recomputes all tokens without changing the stored source color', () => {
  const properties = new Map<string, string>()
  const root = { setProperty(name: string, value: string) { properties.set(name, value) } }
  applyThemeColor('#123456', 'dark', root)
  const dark = properties.get('--color-accent')!
  applyThemeColor('#123456', 'light', root)
  assert.ok(luminance(dark) > luminance(properties.get('--color-accent')!))
  assert.equal(properties.get('--color-link'), properties.get('--color-accent'))
  assert.equal(properties.get('--color-ink-on-accent'), '#ffffff')
})

test('CSS before React starts matches the derived default in both themes', () => {
  const css = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  const light = css.indexOf(':root:not(.dark) {')
  for (const [mode, source] of [['dark', css.slice(0, light)], ['light', css.slice(light)]] as const) {
    const colors = deriveThemeColors(DEFAULT_THEME_COLOR, mode)
    for (const [token, color] of [['accent', colors.accent], ['accent-strong', colors.accentStrong], ['link', colors.link], ['ink-on-accent', colors.inkOnAccent]]) assert.ok(source.includes(`--color-${token}: ${color};`))
  }
})
