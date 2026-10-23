import type { CSSProperties, ReactNode } from 'react'

export function FrontmatterTag({ children, title, hue }: { children: ReactNode; title?: string; hue?: number }) {
  return <span title={title} style={hue === undefined ? undefined : { '--option-hue': hue } as CSSProperties}
    className={`max-w-full break-words rounded px-1.5 py-0.5 ${hue === undefined ? 'bg-surface-hover text-ink-secondary' : 'frontmatter-choice-tag'}`}>{children}</span>
}
