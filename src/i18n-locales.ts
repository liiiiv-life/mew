export const LOCALES = ['ko', 'en', 'zh-CN', 'ja'] as const
export type Locale = (typeof LOCALES)[number]

export const LOCALE_NAMES: Record<Locale, string> = {
  ko: '한국어',
  en: 'English',
  'zh-CN': '简体中文',
  ja: '日本語',
}

export function preferredLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const normalized = language.toLowerCase()
    if (normalized === 'ko' || normalized.startsWith('ko-')) return 'ko'
    if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja'
    if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
    if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  }
  return 'ko'
}
