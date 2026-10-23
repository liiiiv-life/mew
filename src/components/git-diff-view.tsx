import { useMemo } from 'react'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'

type ParsedDiffLine = { content: string; kind: 'add' | 'delete' | 'hunk' | 'meta' | 'context'; oldLine: number | null; newLine: number | null }

function parseDiff(diff: string): ParsedDiffLine[] {
  let oldLine: number | null = null
  let newLine: number | null = null
  return diff.split('\n').map((content) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(content)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      return { content, kind: 'hunk', oldLine: null, newLine: null }
    }
    if (oldLine === null || newLine === null || content === '' || content.startsWith('\\')) return { content, kind: 'meta', oldLine: null, newLine: null }
    if (content.startsWith('+')) {
      const line = { content, kind: 'add' as const, oldLine: null, newLine }
      newLine += 1
      return line
    }
    if (content.startsWith('-')) {
      const line = { content, kind: 'delete' as const, oldLine, newLine: null }
      oldLine += 1
      return line
    }
    const line = { content, kind: 'context' as const, oldLine, newLine }
    oldLine += 1
    newLine += 1
    return line
  })
}

export function DiffView({ diff, loading }: { diff: string; loading: boolean }) {
  useUiLocale()
  const lines = useMemo(() => parseDiff(diff), [diff])
  if (loading) return <div className="p-5 text-center text-xs text-ink-muted">{uiText("diff를 불러오는 중…")}</div>
  if (!diff) return <div className="p-5 text-center text-xs text-ink-muted">{uiText("표시할 변경 내용이 없습니다.")}</div>
  return (
    <div className="w-max min-w-full py-2 font-mono text-[11px] leading-5 text-ink-secondary">
      {lines.map((line, index) => (
        <div key={index} className={`grid min-w-full grid-cols-[3.25rem_3.25rem_minmax(max-content,1fr)] ${line.kind === 'add' ? 'bg-emerald-500/10 text-emerald-500' : line.kind === 'delete' ? 'bg-red-500/10 text-red-400' : line.kind === 'hunk' ? 'bg-accent/5 text-accent' : ''}`}>
          <span className="select-none border-r border-edge px-2 text-right text-ink-muted">{line.oldLine ?? ''}</span>
          <span className="select-none border-r border-edge px-2 text-right text-ink-muted">{line.newLine ?? ''}</span>
          <code className="whitespace-pre px-3">{line.content || ' '}</code>
        </div>
      ))}
    </div>
  )
}
