import type { GitChangedFile } from '../api/client'

export type GitWorkbenchView =
  | { kind: 'graph' }
  | { kind: 'commit'; hash: string }
  | { kind: 'diff'; source: { kind: 'working' } | { kind: 'commit'; hash: string }; file: GitChangedFile }

export interface GitWorkbenchNavigation {
  view: GitWorkbenchView
  onChange: (view: GitWorkbenchView) => void
  back: () => boolean
}

export function gitWorkbenchScreenKey(view: GitWorkbenchView): string {
  if (view.kind === 'graph') return 'graph'
  if (view.kind === 'commit') return `commit:${view.hash}`
  return JSON.stringify(['diff', view.source.kind, view.source.kind === 'commit' ? view.source.hash : null, view.file.path])
}
