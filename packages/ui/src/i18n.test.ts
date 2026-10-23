import assert from 'node:assert/strict'
import test from 'node:test'
import { getUiLocale, setUiLocale, subscribeUiLocale, translateUi, uiText, uiWeekdays } from './i18n-core.ts'
import { uiMessages, type UiMessage } from './ui-messages.ts'

const placeholders = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort()

test('every shared UI message has three translations with matching placeholders', () => {
  for (const [source, translations] of Object.entries(uiMessages)) {
    assert.equal(translations.length, 3, source)
    for (const translated of translations) {
      assert.ok(translated.trim(), source)
      assert.doesNotMatch(translated, /[가-힣]/, source)
      assert.deepEqual(placeholders(translated), placeholders(source), source)
    }
    assert.equal(translateUi('ko', source as UiMessage), source)
  }
})

test('interpolation preserves user text, including Korean, dollar signs and braces', () => {
  const name = '한국어 $& {name} <script>'
  assert.equal(translateUi('en', '{name} 여는 중…', { name }), `Opening ${name}…`)
  assert.equal(translateUi('ja', '{name} 여는 중…', { name }), `${name} を開いています…`)
  assert.equal(translateUi('zh-CN', '{name} 여는 중…', { name }), `正在打开 ${name}…`)
  assert.equal(translateUi('en', '{name} 여는 중…'), 'Opening {name}…')
})

test('shared UI locale updates subscribers once, supports cleanup, and formats weekdays', () => {
  const initial = getUiLocale()
  let updates = 0
  const unsubscribe = subscribeUiLocale(() => { updates++ })
  try {
    setUiLocale('en')
    setUiLocale('en')
    assert.equal(updates, 1)
    assert.equal(uiText('히스토리'), 'History')
    assert.deepEqual(uiWeekdays(), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    setUiLocale('ja')
    assert.equal(uiText('현재 대화 새로고침'), '現在の会話を再読み込み')
    assert.equal(uiWeekdays()[0], '日')
    unsubscribe()
    setUiLocale('ko')
    assert.equal(updates, 2)
    assert.equal(uiWeekdays()[0], '일')
  } finally {
    unsubscribe()
    setUiLocale(initial)
  }
})
