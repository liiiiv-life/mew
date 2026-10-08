import { uiMessages, type UiMessage } from './ui-messages.ts'

export type UiLocale = 'ko' | 'en' | 'zh-CN' | 'ja'
const translationIndex = { en: 0, 'zh-CN': 1, ja: 2 } as const
let locale: UiLocale = 'ko'
const listeners = new Set<() => void>()

export function getUiLocale(): UiLocale { return locale }
export function hasUiMessage(message: string): message is UiMessage { return Object.hasOwn(uiMessages, message) }

/** Shared by React, editor node views and event-time utility messages. */
export function setUiLocale(next: UiLocale): void {
  if (locale === next) return
  locale = next
  for (const listener of listeners) listener()
}

export function subscribeUiLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function translateUi(locale: UiLocale, message: UiMessage, values?: Record<string, unknown>): string {
  const translated = locale === 'ko' ? message : uiMessages[message][translationIndex[locale]]
  return values ? translated.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match) : translated
}

export function uiText(message: UiMessage, values?: Record<string, unknown>, language: UiLocale = locale): string {
  return translateUi(language, message, values)
}

/** Sunday first, independent of the host timezone and translated date-unit labels. */
export function uiWeekdays(): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  return Array.from({ length: 7 }, (_, day) => formatter.format(new Date(Date.UTC(2024, 0, 7 + day))))
}
