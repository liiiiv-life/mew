import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DEFAULT_THEME_COLOR, THEME_COLOR_KEY, applyThemeColor, deriveThemeColors, loadThemeColor, normalizeThemeColor, saveThemeColor, DEFAULT_THEME_PALETTE, THEME_PRESETS, THEME_SETTINGS_KEY, applyThemePalette, colorContrast, deriveThemePalette, loadThemeSettings, normalizeThemeSettings, sameThemePalette, saveThemeSettings, themeBackgroundImage, themePaletteContrast, themePaletteMode, type ThemePalette } from './theme-color.ts'

function luminance(hex: string) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
}
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
const blend = (a: string, b: string, weight: number) => '#' + [1, 3, 5].map(index => Math.round(parseInt(a.slice(index, index + 2), 16) * (1 - weight) + parseInt(b.slice(index, index + 2), 16) * weight).toString(16).padStart(2, '0')).join('')
function composite(fill: string, backdrop: string): string {
  assert.match(fill, /^#[0-9a-f]{8}$/)
  assert.match(backdrop, /^#[0-9a-f]{6}$/)
  return blend(backdrop, fill, parseInt(fill.slice(7), 16) / 255)
}

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

test('derived highlights retain source hue and HSL saturation instead of mixing in white', () => {
  const hsl = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
    return {
      saturation: delta === 0 ? 0 : delta / (1 - Math.abs(max + min - 1)),
      hue: delta === 0 ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4,
    }
  }
  for (const color of [DEFAULT_THEME_COLOR, '#bb2200', '#006633', '#0044cc', '#ff00ff', '#00ffff', '#ffff00', '#808080', '#000000', '#ffffff']) {
    const source = hsl(color)
    for (const mode of ['dark', 'light'] as const) {
      const colors = deriveThemeColors(color, mode)
      for (const value of [colors.accent, colors.accentStrong, colors.link]) {
        const derived = hsl(value)
        assert.ok(Math.abs(derived.saturation - source.saturation) < .015, `${color} ${mode} ${value} saturation`)
        if (source.saturation > 0) {
          const distance = Math.abs(derived.hue - source.hue)
          assert.ok(Math.min(distance, 6 - distance) < .03, `${color} ${mode} ${value} hue`)
        }
      }
    }
  }
})

test('three-color themes inherit the previous visible dark/light appearance and keep a migrated custom theme', () => {
  for (const mode of ['dark', 'light'] as const) {
    const values = new Map([['mew:theme', mode], [THEME_COLOR_KEY, '#185e91']])
    const storage = { getItem: (key: string) => values.get(key) ?? null }
    const settings = loadThemeSettings(storage)
    assert.deepEqual(settings.palette, { ...THEME_PRESETS[mode === 'dark' ? 0 : 1].palette, primary: deriveThemeColors('#185e91', mode).accent })
    assert.deepEqual(settings.custom, [settings.palette])
    values.set(THEME_SETTINGS_KEY, '{broken')
    assert.deepEqual(loadThemeSettings(storage), settings)
    values.set(THEME_SETTINGS_KEY, JSON.stringify({ palette: { background: 'bad', text: '#123456', primary: '#abcdef' } }))
    assert.deepEqual(loadThemeSettings(storage), settings)
  }
  assert.deepEqual(loadThemeSettings({ getItem: () => null }), { palette: DEFAULT_THEME_PALETTE, custom: [] })
  assert.deepEqual(loadThemeSettings({ getItem: () => { throw Error('blocked') } }), { palette: DEFAULT_THEME_PALETTE, custom: [] })
  const migrated = loadThemeSettings({ getItem: key => key === 'mew:accent-color' ? JSON.stringify({ accent: '#ff0000' }) : null })
  assert.equal(migrated.palette.primary, deriveThemeColors('#ff0000', 'dark').accent)
})

test('new and unreadable settings use Midnight while saved solid dark remains selected', () => {
  const midnight = THEME_PRESETS.find(preset => preset.id === 'midnight')!.palette
  assert.deepEqual(DEFAULT_THEME_PALETTE, midnight)
  for (const raw of [null, '{broken', JSON.stringify({ palette: { background: 'invalid' } })]) {
    assert.deepEqual(loadThemeSettings({ getItem: key => key === THEME_SETTINGS_KEY ? raw : null }), { palette: midnight, custom: [] })
  }
  const dark = THEME_PRESETS[0].palette
  assert.deepEqual(loadThemeSettings({ getItem: key => key === THEME_SETTINGS_KEY ? JSON.stringify({ palette: dark, custom: [] }) : null }), { palette: dark, custom: [] })
  assert.deepEqual(loadThemeSettings({ getItem: key => key === 'mew:theme' ? 'dark' : null }), { palette: dark, custom: [] })
})

test('active and multiple custom themes round-trip together without derived tokens or duplicate presets', () => {
  const palette = { background: '#102030', text: '#FAF0E0', primary: '#DD9922' }
  const other = { background: '#eeeedd', text: '#303030', primary: '#305090' }
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const saved = saveThemeSettings({ palette, custom: [palette, other, palette, DEFAULT_THEME_PALETTE] }, storage)
  assert.deepEqual(saved.custom, [{ background: '#102030', text: '#faf0e0', primary: '#dd9922' }, other])
  assert.deepEqual(loadThemeSettings(storage), saved)
  assert.equal(values.get('mew:theme'), 'dark')
  assert.deepEqual(Object.keys(JSON.parse(values.get(THEME_SETTINGS_KEY)!)), ['palette', 'custom'])
  assert.deepEqual(Object.keys(saved.palette), ['background', 'text', 'primary'])
  assert.deepEqual(saveThemeSettings(saved, { setItem() { throw Error('full') } }), saved)
  assert.equal(palette.text, '#FAF0E0', 'normalization does not mutate the caller')
  values.set(THEME_SETTINGS_KEY, JSON.stringify({ palette: saved.palette, custom: [null, { background: 'red' }, other, other] }))
  assert.deepEqual(loadThemeSettings(storage).custom, [other, saved.palette], 'invalid custom colors are skipped and the active palette is kept selectable')
  assert.deepEqual(normalizeThemeSettings({ palette: DEFAULT_THEME_PALETTE, custom: [other, other] }).custom, [other])
})

test('all preset palettes use the selected three colors and readable links and solid button labels', () => {
  for (const { id, palette } of THEME_PRESETS) {
    const colors = deriveThemePalette(palette)
    assert.equal(colors['surface-deep'], palette.background)
    assert.equal(colors.ink, palette.text)
    assert.equal(colors.accent, palette.primary)
    for (const token of ['surface-deep', 'surface-solid', 'surface-raised-solid'] as const) {
      assert.ok(colorContrast(palette.text, colors[token]) >= 4.5, `${id} body on ${token}`)
      assert.ok(colorContrast(colors.link, colors[token]) >= 4.5, `${id} link on ${token}`)
    }
    for (const token of ['accent', 'accent-strong'] as const) assert.ok(colorContrast(colors['ink-on-accent'], colors[token]) >= 4.5, `${id} button ${token}`)
    assert.notEqual(colors.accent, colors['accent-strong'], `${id} hover changes the primary button`)
    assert.equal(themePaletteMode(palette), ['dark', 'midnight', 'forest'].includes(id) ? 'dark' : 'light')
  }
})

test('only gradient component fills gain alpha, with independent opaque tokens and unchanged source colors', () => {
  const solidSteps = {
    dark: ['#171717', '#171717', '#262626', '#404040'],
    light: ['#f5f5f5', '#f8f8f8', '#efefef', '#e1e1e1'],
    midnight: ['#1c2433', '#1c2433', '#2a3241', '#424b5a'],
    forest: ['#1d2c27', '#1d2c27', '#2c3a35', '#44534d'],
    paper: ['#eee8db', '#f1ebde', '#e9e3d6', '#ddd7ca'],
    rose: ['#f1e6e9', '#f4e9ec', '#ece1e3', '#e1d4d8'],
    ocean: ['#e4edf2', '#e7f0f5', '#dee7ed', '#d0dbe2'],
  }
  const componentTokens = ['surface', 'surface-raised', 'surface-hover'] as const
  for (const { id, palette } of THEME_PRESETS) {
    const snapshot = JSON.stringify(palette)
    const solid = deriveThemePalette({ ...palette, gradient: undefined })
    const colors = deriveThemePalette(palette)
    assert.deepEqual([solid.workspace, ...componentTokens.map(token => solid[token])], solidSteps[id], `${id} keeps the previous solid appearance`)
    for (const [index, token] of componentTokens.entries()) {
      assert.match(colors[`${token}-solid`], /^#[0-9a-f]{6}$/, `${id} ${token} can restore an opaque overlay`)
      assert.equal(colors[token], colors[`${token}-solid`] + (palette.gradient ? ['7a', '94', 'b8'][index] : ''))
    }
    for (const [token, color] of Object.entries(solid)) {
      if (token === 'link' || token.startsWith('surface') && token !== 'surface-deep') continue
      assert.equal(colors[token as keyof typeof colors], color, `${id} preserves ${token}`)
    }
    assert.equal(colors['surface-deep'], palette.background)
    assert.equal(colors.ink, palette.text)
    assert.equal(colors.accent, palette.primary)
    assert.equal(JSON.stringify(palette), snapshot, 'derived alpha fills never change the saved palette')
  }
})

test('gradient component fills reveal the backdrop while preserving readable composited text and links', () => {
  for (const { id, palette } of THEME_PRESETS.filter(preset => preset.palette.gradient)) {
    const colors = deriveThemePalette(palette), anchors = [palette.background, ...palette.gradient!.colors]
    assert.notEqual(composite(colors.surface, anchors[0]), composite(colors.surface, anchors[1]), `${id} shows the backdrop through component fills`)
    for (const a of anchors) for (const b of anchors) for (let step = 0; step <= 16; step++) {
      const backdrop = blend(a, b, step / 16)
      for (const token of ['surface', 'surface-raised', 'surface-hover'] as const) {
        const surface = composite(colors[token], backdrop)
        assert.ok(colorContrast(palette.text, surface) >= 4.5, `${id} body on ${token} over ${backdrop}`)
        assert.ok(colorContrast(colors.link, surface) >= 4.5, `${id} link on ${token} over ${backdrop}`)
      }
    }
    assert.ok(colorContrast(palette.text, colors['surface-hover-solid']) >= 4.5, `${id} opaque hover retains readable text`)
    assert.ok(colorContrast(colors.link, colors['surface-hover-solid']) >= 4.5, `${id} opaque hover retains readable links`)
  }
})

test('applying a palette replaces every surface and text token and derives the mode from the background', () => {
  const properties = new Map<string, string>(), modes: boolean[] = [], gradients: boolean[] = []
  const root = { style: { setProperty(name: string, value: string) { properties.set(name, value) } }, classList: { toggle(name: string, force?: boolean) { (name === 'dark' ? modes : gradients).push(!!force); return !!force } } }
  for (const preset of THEME_PRESETS) {
    const colors = applyThemePalette(preset.palette, root as unknown as Pick<HTMLElement, 'style' | 'classList'>)
    for (const [token, color] of Object.entries(colors)) assert.equal(properties.get(`--color-${token}`), color)
    assert.equal(properties.get('--theme-background-image'), themeBackgroundImage(preset.palette))
    assert.equal(properties.get('--theme-background-animation'), preset.palette.gradient?.animated ? 'theme-background-drift 18s ease-in-out infinite alternate' : 'none')
    assert.equal(properties.has('--color-danger'), false, 'semantic error colors remain independent')
  }
  assert.deepEqual(modes, [true, false, true, true, false, false, false])
  assert.deepEqual(gradients, [false, false, true, false, false, true, true])
  applyThemePalette(THEME_PRESETS[0].palette, root as unknown as Pick<HTMLElement, 'style' | 'classList'>)
  assert.equal(properties.get('--theme-background-image'), 'none', 'switching to solid removes the previous mesh')
  assert.equal(properties.get('--theme-background-animation'), 'none')
  assert.ok(sameThemePalette(loadThemeSettings({ getItem: () => null }).palette, DEFAULT_THEME_PALETTE))
})

test('custom gradients normalize, distinguish every setting and round-trip without changing their solid fallback', () => {
  const palette: ThemePalette = { background: '#102030', text: '#FAF0E0', primary: '#DD9922', gradient: { colors: ['#142536', '#302050'], angle: -225, animated: false } }
  const differentColor: ThemePalette = { ...palette, gradient: { ...palette.gradient!, colors: ['#142536', '#302051'] } }
  const differentAngle: ThemePalette = { ...palette, gradient: { ...palette.gradient!, angle: 20 } }
  const differentAnimation: ThemePalette = { ...palette, gradient: { ...palette.gradient!, animated: true } }
  const solid = { background: palette.background, text: palette.text, primary: palette.primary }
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const saved = saveThemeSettings({ palette, custom: [palette, differentColor, differentAngle, differentAnimation, solid] }, storage)
  assert.deepEqual(saved.palette, { ...solid, text: '#faf0e0', primary: '#dd9922', gradient: { colors: ['#142536', '#302050'], angle: 135, animated: false } })
  assert.equal(saved.custom.length, 5)
  assert.deepEqual(loadThemeSettings(storage), saved)
  assert.equal(palette.gradient!.angle, -225, 'normalizing never changes the caller')
  for (const other of [differentColor, differentAngle, differentAnimation, solid]) assert.equal(sameThemePalette(palette, other), false)
  assert.equal(sameThemePalette(palette, { ...palette, gradient: { ...palette.gradient!, colors: [...palette.gradient!.colors] } }), true)
  assert.equal(normalizeThemeSettings({ palette: { ...palette, gradient: { ...palette.gradient!, angle: 720 } }, custom: [] }).palette.gradient!.angle, 0)
  assert.equal(normalizeThemeSettings({ palette: { ...palette, gradient: { ...palette.gradient!, colors: ['#AABBCC', '#DDEEFF'] } }, custom: [] }).palette.gradient!.colors[0], '#aabbcc')
})

test('invalid gradient data drops only the gradient and preserves valid base colors', () => {
  const solid = { background: '#102030', text: '#faf0e0', primary: '#dd9922' }
  for (const gradient of [null, {}, { colors: ['red', '#ffffff'], angle: 0, animated: true }, { colors: ['#000000'], angle: 0, animated: true }, { colors: ['#000000', '#ffffff', '#123456'], angle: 0, animated: true }, { colors: ['#000000', '#ffffff'], angle: NaN, animated: true }, { colors: ['#000000', '#ffffff'], angle: Infinity, animated: true }, { colors: ['#000000', '#ffffff'], angle: '30', animated: true }, { colors: ['#000000', '#ffffff'], angle: 30, animated: 'false' }]) {
    const palette = { ...solid, gradient } as ThemePalette
    assert.deepEqual(normalizeThemeSettings({ palette, custom: [] }).palette, solid)
    assert.equal(themeBackgroundImage(palette), 'none')
  }
})

test('loading old selected gradient presets upgrades them while explicit solid custom themes are preserved', () => {
  for (const { palette } of THEME_PRESETS.filter(preset => preset.palette.gradient)) {
    const solid = { background: palette.background, text: palette.text, primary: palette.primary }
    const load = (value: unknown) => loadThemeSettings({ getItem: key => key === THEME_SETTINGS_KEY ? JSON.stringify(value) : null })
    assert.deepEqual(load({ palette: solid, custom: [] }), { palette, custom: [] })
    assert.deepEqual(load({ palette: solid, custom: [solid] }), { palette: solid, custom: [solid] })
    assert.deepEqual(normalizeThemeSettings({ palette: solid, custom: [] }), { palette: solid, custom: [solid] })
    assert.deepEqual(load({ palette: { ...solid, gradient: { colors: ['bad', '#ffffff'], angle: 135, animated: true } }, custom: [] }), { palette: solid, custom: [solid] })
  }
})

test('radial meshes reflect direction, keep solid fallback and preserve readable preset body and link contrast', () => {
  for (const { id, palette } of THEME_PRESETS) {
    assert.ok(themePaletteContrast(palette) >= 4.5, `${id} body across its background`)
    if (!palette.gradient) {
      assert.equal(themeBackgroundImage(palette), 'none')
      continue
    }
    const image = themeBackgroundImage(palette)
    assert.ok(image.includes('radial-gradient'))
    for (const color of palette.gradient.colors) assert.ok(image.includes(color))
    assert.notEqual(image, themeBackgroundImage({ ...palette, gradient: { ...palette.gradient, angle: palette.gradient.angle + 90 } }))
    const link = deriveThemePalette(palette).link
    const anchors = [palette.background, ...palette.gradient.colors]
    for (const a of anchors) for (const b of anchors) for (let step = 0; step <= 16; step++) {
      const surface = blend(a, b, step / 16)
      assert.ok(colorContrast(palette.text, surface) >= 4.5, `${id} body on ${surface}`)
      assert.ok(colorContrast(link, surface) >= 4.5, `${id} link on ${surface}`)
    }
  }
  const cancellation: ThemePalette = { background: '#000000', text: '#777777', primary: '#ffffff', gradient: { colors: ['#ffffff', '#eeeeee'], angle: 135, animated: false } }
  assert.equal(themePaletteContrast(cancellation), 1, 'text luminance within the continuous background range has an unreadable point')
  const interior: ThemePalette = { background: '#ff0000', text: '#000000', primary: '#ffffff', gradient: { colors: ['#00ff00', '#0000ff'], angle: 135, animated: false } }
  assert.ok(themePaletteContrast(interior) < Math.min(...[interior.background, ...interior.gradient!.colors].map(color => colorContrast(interior.text, color))), 'contrast also checks blended colors between the three anchors')
})

test('arbitrary black, white and saturated primary colors keep their source and readable solid button labels', () => {
  for (const background of ['#0a0a0a', '#101827', '#f6f0e3', '#ffffff']) {
    for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) {
      const primary = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
      const colors = deriveThemePalette({ background, text: background === '#0a0a0a' || background === '#101827' ? '#e5e5e5' : '#262626', primary })
      assert.equal(colors.accent, primary)
      for (const token of ['accent', 'accent-strong'] as const) assert.ok(colorContrast(colors['ink-on-accent'], colors[token]) >= 4.5, `${background} ${primary} ${token}`)
      for (const token of ['surface-deep', 'surface', 'surface-raised'] as const) assert.ok(colorContrast(colors.link, colors[token]) >= 4.5, `${background} ${primary} link on ${token}`)
    }
  }
})
