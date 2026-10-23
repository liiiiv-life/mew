import assert from 'node:assert/strict'
import test from 'node:test'
import { preferredLocale } from './i18n-locales.ts'

test('preferredLocale selects each supported browser language', () => {
  assert.equal(preferredLocale(['en-US', 'ko-KR']), 'en')
  assert.equal(preferredLocale(['zh-TW']), 'zh-CN')
  assert.equal(preferredLocale(['ja-JP']), 'ja')
  assert.equal(preferredLocale(['ko-KR']), 'ko')
})

test('preferredLocale falls back to Korean for unsupported languages', () => {
  assert.equal(preferredLocale(['fr-FR']), 'ko')
  assert.equal(preferredLocale([]), 'ko')
})
