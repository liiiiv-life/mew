export const guidanceOptions = {
  commit: {
    inherit: '',
    always: 'After each completed change, commit the files changed for that task. Keep unrelated changes out of the commit. Do not push unless requested.',
    requested: 'Create Git commits only when the user explicitly requests them. Do not push unless requested.',
  },
  language: {
    inherit: '',
    ko: 'Respond to the user in Korean.',
    en: 'Respond to the user in English.',
    ja: 'Respond to the user in Japanese.',
    zh: 'Respond to the user in Simplified Chinese.',
  },
  detail: {
    inherit: '',
    concise: 'Keep responses concise, focusing on results and essential information.',
    detailed: 'Provide detailed responses with relevant reasoning and verification results.',
  },
} as const

export type GuidanceKey = keyof typeof guidanceOptions
export type GuidanceSnapshot = {
  path: string
  content: string
  revision: string
  settings: Record<GuidanceKey, string>
}
