import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import {
  DEFAULT_FONT_PREFERENCES,
  FONT_PREFERENCES_KEY,
  applyFontPreferences,
  loadFontPreferences,
  normalizeFontPreferences,
  saveFontPreferences,
} from './fontPreferences.ts'

test('기본 UI와 마크다운 글꼴은 IBM Plex Sans KR이다', () => {
  assert.deepEqual(DEFAULT_FONT_PREFERENCES, {
    ui: 'IBM Plex Sans KR',
    markdown: 'IBM Plex Sans KR',
    mono: 'IBM Plex Mono',
  })
})

test('저장된 세 글꼴을 복원하고 빠진 값은 기본값으로 채운다', () => {
  const storage = {
    getItem: (key: string) => key === FONT_PREFERENCES_KEY ? JSON.stringify({ ui: 'Pretendard', mono: 'Menlo' }) : null,
  }
  assert.deepEqual(loadFontPreferences(storage), {
    ui: 'Pretendard',
    markdown: DEFAULT_FONT_PREFERENCES.markdown,
    mono: 'Menlo',
  })
})

test('깨진 저장값과 빈 글꼴명은 안전한 기본값으로 돌아간다', () => {
  assert.deepEqual(loadFontPreferences({ getItem: () => '{' }), DEFAULT_FONT_PREFERENCES)
  assert.deepEqual(normalizeFontPreferences({ ui: '  ', markdown: '\n', mono: null }), DEFAULT_FONT_PREFERENCES)
})

test('CSS 변수는 글꼴별 폴백과 함께 독립 적용된다', () => {
  const values = new Map<string, string>()
  applyFontPreferences(
    { ui: 'Pretendard', markdown: 'Georgia', mono: 'ui-monospace' },
    { setProperty: (name, value) => { values.set(name, value) } },
  )
  assert.equal(values.get('--mew-font-ui'), '"Pretendard", ui-sans-serif, system-ui, sans-serif')
  assert.equal(values.get('--mew-font-markdown'), '"Georgia", ui-sans-serif, system-ui, sans-serif')
  assert.equal(values.get('--mew-font-mono'), 'ui-monospace, "IBM Plex Sans KR", ui-monospace, monospace')
})

test('저장할 때 제어 문자를 없애고 정규화한다', () => {
  let saved = ''
  const result = saveFontPreferences(
    { ui: '  IBM Plex Sans KR  ', markdown: 'Noto\nSerif KR', mono: 'IBM Plex Mono' },
    { setItem: (_key, value) => { saved = value } },
  )
  assert.deepEqual(result, { ui: 'IBM Plex Sans KR', markdown: 'NotoSerif KR', mono: 'IBM Plex Mono' })
  assert.deepEqual(JSON.parse(saved), result)
})

test('기본 글꼴은 외부 CSS를 받지 않고 선택한 Noto Serif만 한 번 준비한다', t => {
  const window = new Window({ settings: { disableCSSFileLoading: true } })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document })
  t.after(async () => {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
    await window.happyDOM.abort()
  })
  const root = window.document.documentElement.style
  applyFontPreferences(DEFAULT_FONT_PREFERENCES, root)
  assert.equal(window.document.head.querySelectorAll('link').length, 0)
  const selected = { ...DEFAULT_FONT_PREFERENCES, markdown: 'Noto Serif KR' }
  applyFontPreferences(selected, root)
  applyFontPreferences(selected, root)
  assert.equal(window.document.head.querySelectorAll('link[rel="stylesheet"]').length, 1)
  assert.match(window.document.head.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')!.href, /family=Noto\+Serif\+KR/)
  assert.match(root.getPropertyValue('--mew-font-markdown'), /Noto Serif KR/)
})
