import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { useDialog, useOverlayDismiss } from '@mew/ui'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp } from 'iconoir-react'
import { relativeCommitTime } from '../utils/git-time'
import { GitAiCommitDialog } from './git-ai-commit-dialog'
import {
  commitGitWorkingTree,
  fetchGitCommit,
  fetchGitDiff,
  fetchGitLog,
  fetchGitRepository,
  fetchGitWorkingTree,
  fetchGitWorkingTreeDiff,
  runGitCommitAction,
  runGitRemoteAction,
  type GitChangedFile,
  type GitCommitAction,
  type GitCommitDetail,
  type GitLogEntry,
  type GitRepositoryInfo,
  type GitWorkingTreeDetail,
} from '../api/client'

const LANE_GAP = 10
const ROW_HEIGHT = 28
const GRAPH_COLORS = ['#5da9ff', '#f28b82', '#81c995', '#fdd663', '#c58af9', '#78d9ec', '#ff8bcb']

type GraphEdge = { from: number; to: number; commit: boolean }
type GraphRow = { lane: number; before: number; after: number; edges: GraphEdge[] }
type DetailSource = { kind: 'working' } | { kind: 'commit'; hash: string }
type WorkbenchView =
  | { kind: 'graph' }
  | { kind: 'commit'; hash: string }
  | { kind: 'diff'; source: DetailSource; file: GitChangedFile }

function graphLayout(commits: GitLogEntry[]): { rows: GraphRow[]; lanes: number } {
  let active: string[] = []
  let max = 1
  const rows = commits.map((commit) => {
    if (!active.includes(commit.hash)) active.unshift(commit.hash)
    const before = [...active]
    const lane = before.indexOf(commit.hash)
    const next = before.filter((hash) => hash !== commit.hash)
    let insert = Math.min(lane, next.length)
    for (const parent of commit.parents) {
      if (next.includes(parent)) continue
      next.splice(insert, 0, parent)
      insert += 1
    }
    const edges: GraphEdge[] = []
    before.forEach((hash, from) => {
      if (hash === commit.hash) return
      const to = next.indexOf(hash)
      if (to >= 0) edges.push({ from, to, commit: false })
    })
    commit.parents.forEach((parent) => {
      const to = next.indexOf(parent)
      if (to >= 0) edges.push({ from: lane, to, commit: true })
    })
    max = Math.max(max, before.length, next.length)
    active = next
    return { lane, before: before.length, after: next.length, edges }
  })
  return { rows, lanes: max }
}

function GraphCell({ row, width }: { row: GraphRow; width: number }) {
  useUiLocale()
  const x = (lane: number) => 8 + lane * LANE_GAP
  const mid = ROW_HEIGHT / 2
  return (
    <svg width={width} height={ROW_HEIGHT} className="block shrink-0" aria-hidden="true">
      {Array.from({ length: row.before }, (_, lane) => (
        <path key={`top-${lane}`} d={`M ${x(lane)} 0 L ${x(lane)} ${mid}`} stroke={GRAPH_COLORS[lane % GRAPH_COLORS.length]} strokeWidth="1.25" fill="none" />
      ))}
      {row.edges.map((edge, index) => (
        <path
          key={`${edge.from}-${edge.to}-${index}`}
          d={`M ${x(edge.from)} ${edge.commit ? mid : 0} C ${x(edge.from)} ${mid}, ${x(edge.to)} ${mid}, ${x(edge.to)} ${ROW_HEIGHT}`}
          stroke={GRAPH_COLORS[edge.from % GRAPH_COLORS.length]}
          strokeWidth="1.25"
          fill="none"
        />
      ))}
      <circle cx={x(row.lane)} cy={mid} r="3" fill={GRAPH_COLORS[row.lane % GRAPH_COLORS.length]} stroke="var(--color-surface)" strokeWidth="1" />
    </svg>
  )
}

function shortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

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

function DiffView({ diff, loading }: { diff: string; loading: boolean }) {
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

function statusLabel(status: string): string {
  if (status === '??') return '?'
  const [index = ' ', working = ' '] = status
  if (index === ' ') return working
  if (working === ' ' || working === index) return index
  return `${index}${working}`
}

function ChangedFiles({ files, onSelect, compact = false, selected, onToggle, disabled }: { files: GitChangedFile[]; onSelect: (file: GitChangedFile) => void; compact?: boolean; selected?: Set<string>; onToggle?: (path: string) => void; disabled?: boolean }) {
  useUiLocale()
  if (files.length === 0) return <div className="p-6 text-center text-xs text-ink-muted">{uiText("변경된 파일이 없습니다.")}</div>
  return (
    <div className="divide-y divide-edge">
      {files.map((file) => (
        <div key={file.path} className="flex items-center">
          {selected && onToggle && <label className="flex shrink-0 cursor-pointer items-center self-stretch pl-3 pr-1">
            <input type="checkbox" checked={selected.has(file.path)} disabled={disabled} onChange={() => onToggle(file.path)} aria-label={uiText("{p0} 커밋에 포함", { p0: file.path })} className="h-4 w-4 accent-accent focus-visible:outline-2 focus-visible:outline-accent" />
          </label>}
          <button type="button" onClick={() => onSelect(file)} className={`flex min-w-0 flex-1 items-center text-left text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink ${compact ? 'gap-2 px-3 py-1.5' : 'gap-3 px-4 py-3'}`}>
            <span className="w-7 shrink-0 rounded bg-surface-deep py-0.5 text-center font-mono text-[9px] text-accent" title={file.status}>{statusLabel(file.status)}</span>
            <span className="min-w-0 flex-1 truncate" title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}>{file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}</span>
            <span className="text-ink-muted" aria-hidden="true">›</span>
          </button>
        </div>
      ))}
    </div>
  )
}

function BackIcon() {
  useUiLocale()
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
}

function GitSplitHandle({ ratio, onChange }: { ratio: number; onChange: (ratio: number) => void }) {
  useUiLocale()
  const drag = useRef<{ pointerId: number; y: number; ratio: number; height: number } | null>(null)
  const update = (value: number) => onChange(Math.max(0.15, Math.min(0.85, value)))
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (active?.pointerId === event.pointerId) update(active.ratio + (event.clientY - active.y) / active.height)
  }
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div role="separator" tabIndex={0} aria-label={uiText("커밋 기록과 변경사항 높이 조절")} aria-orientation="horizontal"
    aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(ratio * 100)}
    className="relative z-10 h-1 shrink-0 cursor-row-resize touch-none bg-edge before:absolute before:-inset-y-1 before:inset-x-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    onKeyDown={(event) => {
      const next = event.key === 'ArrowUp' ? ratio - 0.05 : event.key === 'ArrowDown' ? ratio + 0.05 : event.key === 'Home' ? 0.15 : event.key === 'End' ? 0.85 : null
      if (next !== null) { event.preventDefault(); event.stopPropagation(); update(next) }
    }}
    onPointerDown={(event) => {
      if (event.button !== 0 || !event.isPrimary || drag.current) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.focus({ preventScroll: true })
      drag.current = { pointerId: event.pointerId, y: event.clientY, ratio, height: Math.max(1, (event.currentTarget.parentElement?.clientHeight ?? 4) - 4) }
    }}
    onPointerMove={move}
    onPointerUp={(event) => { move(event); end(event) }}
    onPointerCancel={end}
    onLostPointerCapture={end}
  />
}

function GitComposer({ children, onSubmit }: { children: ReactNode; onSubmit: () => void }) {
  useUiLocale()
  const form = useRef<HTMLFormElement>(null)
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  const [availableHeight, setAvailableHeight] = useState(0)
  useLayoutEffect(() => {
    const parent = form.current?.parentElement
    if (!parent) return
    const measure = () => { if (parent.clientHeight > 0) setAvailableHeight(parent.clientHeight) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])
  const minHeight = 144
  const maxHeight = Math.max(minHeight, Math.floor(availableHeight * 0.7))
  const clamp = (value: number) => Math.max(minHeight, Math.min(maxHeight, value))
  const visibleHeight = clamp(height ?? availableHeight * 0.375)
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (active?.pointerId === event.pointerId) setHeight(clamp(active.height + active.y - event.clientY))
  }
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <form ref={form} aria-label={uiText("커밋 작성")} className="relative min-h-36 shrink-0 border-t border-edge" style={{ height: visibleHeight }} onSubmit={event => { event.preventDefault(); onSubmit() }}>
    <div role="separator" tabIndex={0} aria-label={uiText("입력창 높이 조절")} aria-orientation="horizontal"
      aria-valuemin={minHeight} aria-valuemax={maxHeight} aria-valuenow={Math.round(visibleHeight)}
      title={uiText("끌어서 입력창 높이 조절")}
      className="group absolute inset-x-0 -top-1.5 z-20 h-3 cursor-row-resize touch-none outline-none"
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || drag.current) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.focus({ preventScroll: true })
        drag.current = { pointerId: event.pointerId, y: event.clientY, height: form.current?.getBoundingClientRect().height ?? visibleHeight }
      }}
      onPointerMove={move}
      onPointerUp={event => { move(event); end(event) }}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={event => {
        const next = event.key === 'ArrowUp' ? visibleHeight + 12 : event.key === 'ArrowDown' ? visibleHeight - 12 : event.key === 'Home' ? minHeight : event.key === 'End' ? maxHeight : null
        if (next !== null) { event.preventDefault(); event.stopPropagation(); setHeight(clamp(next)) }
      }}
    >
      <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent group-hover:bg-accent group-focus-visible:bg-accent" />
    </div>
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto p-3">{children}</div>
  </form>
}

export function GitWorkbench({ project, repositoryPath, onNotice, onBack, actionsHost }: {
  project: string
  repositoryPath: string
  onNotice: (message: string) => void
  onBack?: () => void
  actionsHost?: HTMLElement | null
}) {
  useUiLocale()
  const [splitRatio, setSplitRatio] = useState(0.2)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const [info, setInfo] = useState<GitRepositoryInfo | null>(null)
  const [commits, setCommits] = useState<GitLogEntry[]>([])
  const [workingTree, setWorkingTree] = useState<GitWorkingTreeDetail>({ files: [] })
  const [view, setView] = useState<WorkbenchView>({ kind: 'graph' })
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const [diff, setDiff] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [remoteAction, setRemoteAction] = useState<'pull' | 'push' | null>(null)
  const [actionRunning, setActionRunning] = useState(false)
  const remotePending = useRef(false)
  const busy = committing || actionRunning || remoteAction !== null
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [commitTitle, setCommitTitle] = useState('')
  const [commitDescription, setCommitDescription] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ commit: GitLogEntry; x: number; y: number } | null>(null)
  useOverlayDismiss(menu ? () => setMenu(null) : false)
  const graph = useMemo(() => graphLayout(commits), [commits])
  const graphWidth = 16 + (graph.lanes - 1) * LANE_GAP

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const nextInfo = await fetchGitRepository(repositoryPath, project)
      setInfo(nextInfo)
      if (!nextInfo.repository) { setCommits([]); setWorkingTree({ files: [] }); setView({ kind: 'graph' }); return }
      const [log, nextWorkingTree] = await Promise.all([
        fetchGitLog(repositoryPath, project),
        fetchGitWorkingTree(repositoryPath, project),
      ])
      setNow(Date.now())
      setCommits(log.commits)
      setWorkingTree(nextWorkingTree)
      setSelectedFiles(current => new Set(nextWorkingTree.files.filter(file => current.has(file.path)).map(file => file.path)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [project, repositoryPath])

  useEffect(() => {
    setView({ kind: 'graph' })
    setCommitTitle('')
    setCommitDescription('')
    setSelectedFiles(new Set())
    setSplitRatio(0.2)
    setAiOpen(false)
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close, { once: true })
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  useEffect(() => {
    if (view.kind !== 'commit') return
    let alive = true
    setDetail(null)
    setDetailLoading(true)
    setError(null)
    fetchGitCommit(repositoryPath, view.hash, project)
      .then((next) => { if (alive) setDetail(next) })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (alive) setDetailLoading(false) })
    return () => { alive = false }
  }, [project, repositoryPath, view])

  useEffect(() => {
    if (view.kind !== 'diff') return
    let alive = true
    setDiff('')
    setDiffLoading(true)
    setError(null)
    const request = view.source.kind === 'working'
      ? fetchGitWorkingTreeDiff(repositoryPath, view.file.path, project)
      : fetchGitDiff(repositoryPath, view.source.hash, view.file.path, project)
    request
      .then((result) => { if (alive) setDiff(result.diff) })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (alive) setDiffLoading(false) })
    return () => { alive = false }
  }, [project, repositoryPath, view])

  const goBack = () => {
    setError(null)
    setView((current) => {
      if (current.kind === 'diff') return current.source.kind === 'working' ? { kind: 'graph' } : { kind: 'commit', hash: current.source.hash }
      return { kind: 'graph' }
    })
  }

  const selectCommitFile = (file: GitChangedFile) => {
    if (view.kind !== 'commit') return
    setView({ kind: 'diff', source: { kind: 'commit', hash: view.hash }, file })
  }

  const commit = async () => {
    if (!commitTitle.trim() || selectedFiles.size === 0 || busy) return
    setCommitting(true)
    setError(null)
    try {
      await commitGitWorkingTree(repositoryPath, commitTitle, commitDescription, project, [...selectedFiles])
      setCommitTitle('')
      setCommitDescription('')
      setSelectedFiles(new Set())
      setView({ kind: 'graph' })
      onNotice(uiText("변경사항을 커밋했습니다"))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCommitting(false)
    }
  }

  const dialogs = useDialog()

  const act = async (action: GitCommitAction, selected: GitLogEntry) => {
    if (busy) return
    setMenu(null)
    let name: string | undefined
    if (action === 'branch') {
      name = (await dialogs.prompt({ message: uiText("브랜치 만들기"), label: uiText("브랜치 이름"), detail: uiText("{p0}에서 생성", { p0: selected.hash.slice(0, 8) }), confirmLabel: uiText("만들기") }))?.trim()
      if (!name) return
    } else if (action === 'tag') {
      name = (await dialogs.prompt({ message: uiText("태그 만들기"), label: uiText("태그 이름"), detail: uiText("{p0}에 생성", { p0: selected.hash.slice(0, 8) }), confirmLabel: uiText("만들기") }))?.trim()
      if (!name) return
    } else {
      const labels: Record<Exclude<GitCommitAction, 'branch' | 'tag'>, string> = { checkout: uiText("이 커밋을 detached HEAD로 checkout"), 'cherry-pick': uiText("현재 브랜치에 cherry-pick"), revert: uiText("현재 브랜치에서 revert 커밋 생성") }
      if (!(await dialogs.confirm({ message: uiText("{p0}할까요?", { p0: labels[action] }), detail: `${selected.hash.slice(0, 8)} ${selected.subject}`, confirmLabel: uiText("실행"), danger: true }))) return
    }
    if (remotePending.current) return
    setActionRunning(true)
    try {
      await runGitCommitAction(repositoryPath, action, selected.hash, name, project)
      onNotice(uiText("Git 작업을 완료했습니다"))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionRunning(false)
    }
  }

  const heading = view.kind === 'graph'
    ? ''
    : view.kind === 'commit'
        ? detail?.subject ?? uiText("커밋 상세")
        : view.file.path

  const syncRemote = async (action: 'pull' | 'push') => {
    if (busy || remotePending.current || loading || aiOpen || !info?.repository || info.detached || !info.workspace) return
    remotePending.current = true
    setRemoteAction(action)
    setError(null)
    try {
      await runGitRemoteAction(repositoryPath, action, project, info.workspace)
      onNotice(uiText("Git 작업을 완료했습니다"))
      setView({ kind: 'graph' })
      await refresh()
    } catch (err) {
      await refresh()
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      remotePending.current = false
      setRemoteAction(null)
    }
  }

  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface">
      {dialogs.dialog}
      {actionsHost && createPortal((['pull', 'push'] as const).map(action => {
        const Icon = action === 'pull' ? ArrowDown : ArrowUp
        const label = action === 'pull' ? 'Pull' : 'Push'
        return <button key={action} type="button" title={label} aria-label={label} aria-busy={remoteAction === action}
          disabled={busy || loading || aiOpen || !info?.repository || info.detached || !info.workspace || !info.remotes?.length}
          onClick={() => { void syncRemote(action) }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
          <Icon width={16} height={16} aria-hidden="true" className={remoteAction === action ? 'animate-pulse' : undefined} />
        </button>
      }), actionsHost)}
      {aiOpen && <GitAiCommitDialog key={project} project={project} files={[...selectedFiles]} onClose={() => { setAiOpen(false); void refresh() }} onFinished={() => { void refresh() }} />}
      {(view.kind !== 'graph' || onBack) && <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge bg-surface-deep px-3">
        {(view.kind !== 'graph' || onBack) && <button type="button" onClick={view.kind === 'graph' ? onBack : goBack} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover hover:text-ink" aria-label={view.kind === 'graph' ? uiText("저장소 목록") : uiText("뒤로 가기")} title={view.kind === 'graph' ? uiText("저장소 목록") : uiText("뒤로 가기")}><BackIcon /></button>}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={heading}>{heading}</span>
      </div>}

      {error && <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-danger/10 px-3 py-2 text-xs text-danger"><span className="select-text min-w-0 flex-1">{error}</span><button type="button" onClick={() => setError(null)} aria-label={uiText("오류 닫기")}>×</button></div>}

      <div className={`${view.kind === 'graph' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}>
        {loading && !info ? (
          <div className="p-5 text-center text-xs text-ink-muted">{uiText("변경사항과 커밋을 불러오는 중…")}</div>
        ) : info?.repository === false || !info ? (
          <div className="p-5 text-center text-xs text-ink-secondary">
            <p role="status">{info?.repository === false ? uiText("현재 프로젝트에 Git 저장소가 없습니다.") : uiText("Git 정보를 불러오지 못했습니다.")}</p>
            <button type="button" onClick={() => void refresh()} disabled={loading} className="mt-3 rounded border border-edge-strong px-3 py-2 hover:bg-surface-hover disabled:opacity-40">{uiText("새로고침")}</button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col" aria-busy={loading}>
            <section aria-label={uiText("커밋 기록")} className="flex min-h-0 flex-col overflow-hidden" style={{ flex: `${splitRatio} 1 0` }}>
              <div className="flex h-8 shrink-0 items-center gap-2 border-b border-edge px-3 text-[11px]">
                <span className="shrink-0 font-medium text-ink">{uiText("커밋 기록")}</span>
                {info.branch && <span className="min-w-0 truncate text-accent" title={info.branch}>{info.branch}</span>}
                {info.detached && <span className="shrink-0 text-warning-ink">detached</span>}
                {!!info.ahead && <span className="shrink-0 text-ink-muted">↑{info.ahead}</span>}
                {!!info.behind && <span className="shrink-0 text-ink-muted">↓{info.behind}</span>}
              </div>
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain" data-git-scroll="history">
                {commits.length === 0 ? (
                  <div className="p-5 text-center text-xs text-ink-muted">{uiText("아직 커밋이 없습니다")}</div>
                ) : commits.map((entry, index) => (
                  <button
                    key={entry.hash}
                    type="button"
                    onClick={() => setView({ kind: 'commit', hash: entry.hash })}
                    onContextMenu={(event) => { event.preventDefault(); setMenu({ commit: entry, x: event.clientX, y: event.clientY }) }}
                    title={`${entry.subject}\n${entry.author} · ${shortDate(entry.date)} · ${entry.hash}${entry.refs.length ? `\n${entry.refs.join(', ')}` : ''}`}
                    className="flex w-full items-center gap-2 pr-3 text-left text-[11px] hover:bg-surface-hover focus-visible:outline-accent"
                    style={{ height: ROW_HEIGHT, minWidth: graphWidth + 220 }}
                  >
                    <GraphCell row={graph.rows[index]} width={graphWidth} />
                    <span className="min-w-16 flex-1 truncate text-ink">{entry.subject}</span>
                    {entry.refs.length > 0 && <span className="hidden max-w-24 shrink-0 truncate rounded bg-surface-deep px-1 text-[9px] text-accent @min-[480px]:inline">{entry.refs[0].replace(/^HEAD -> /, '')}{entry.refs.length > 1 ? ` +${entry.refs.length - 1}` : ''}</span>}
                    <time dateTime={entry.date} className="shrink-0 whitespace-nowrap text-[10px] tabular-nums text-ink-secondary">{relativeCommitTime(entry.date, now)}</time>
                    <span className="shrink-0 font-mono text-[10px] text-ink-secondary">{entry.hash.slice(0, 7)}</span>
                    <span className="w-12 shrink-0 truncate text-[10px] text-ink-secondary @min-[480px]:w-20">{entry.author}</span>
                  </button>
                ))}
              </div>
            </section>
            <GitSplitHandle ratio={splitRatio} onChange={setSplitRatio} />
            <section aria-label={uiText("현재 변경사항")} className="flex min-h-0 flex-col overflow-hidden" style={{ flex: `${1 - splitRatio} 1 0`, minHeight: 'min(224px, 75%)' }}>
              <div className="flex h-9 shrink-0 items-center gap-2 border-b border-edge px-3 text-xs">
                <input type="checkbox" aria-label={uiText("변경 파일 전체 선택")} checked={workingTree.files.length > 0 && selectedFiles.size === workingTree.files.length} ref={node => { if (node) node.indeterminate = selectedFiles.size > 0 && selectedFiles.size < workingTree.files.length }} disabled={busy || workingTree.files.length === 0} onChange={event => setSelectedFiles(new Set(event.target.checked ? workingTree.files.map(file => file.path) : []))} className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-accent" />
                <span className="shrink-0 tabular-nums text-ink-muted" role="status" aria-label={uiText("{count}개 선택", { count: selectedFiles.size })}>{selectedFiles.size}</span>
                <span className="min-w-0 truncate font-medium text-ink">{uiText("커밋되지 않은 변경사항")}</span>
                <span className="shrink-0 tabular-nums text-ink-muted">{workingTree.files.length}</span>
                <button type="button" onClick={() => void refresh()} disabled={loading || busy} className="ml-auto shrink-0 rounded px-2 py-1 text-ink-secondary hover:bg-surface-hover disabled:opacity-40">{uiText("새로고침")}</button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-git-scroll="changes">
                <ChangedFiles compact files={workingTree.files} selected={selectedFiles} disabled={busy} onToggle={path => setSelectedFiles(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next })} onSelect={(file) => setView({ kind: 'diff', source: { kind: 'working' }, file })} />
              </div>
              <GitComposer onSubmit={() => { void commit() }}>
                <div className="flex shrink-0 items-center gap-2">
                  <input value={commitTitle} disabled={busy} onChange={(event) => setCommitTitle(event.target.value)} maxLength={500} placeholder={uiText("커밋 제목")} aria-label={uiText("커밋 제목")} className="min-w-0 flex-1 rounded border border-edge-strong bg-surface-deep px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent" />
                  <button type="submit" disabled={!commitTitle.trim() || selectedFiles.size === 0 || busy} className="shrink-0 rounded bg-accent px-3 py-2 text-xs font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40">{committing ? uiText("커밋 중…") : uiText("커밋")}</button>
                  {view.kind === 'graph' && info?.repository && <button type="button" disabled={busy} onClick={() => setAiOpen(true)} className="shrink-0 rounded border border-edge-strong px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink disabled:opacity-40">{uiText("AI 자동 커밋")}</button>}
                </div>
                <textarea value={commitDescription} disabled={busy} onChange={(event) => setCommitDescription(event.target.value)} maxLength={20000} placeholder={uiText("설명 (선택)")} aria-label={uiText("커밋 설명")} className="min-h-8 w-full flex-1 resize-none rounded border border-edge-strong bg-surface-deep px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-muted focus:border-accent" />
              </GitComposer>
            </section>
          </div>
        )}
      </div>

      {view.kind === 'commit' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {detailLoading ? (
            <div className="p-5 text-center text-xs text-ink-muted">{uiText("커밋을 불러오는 중…")}</div>
          ) : detail && (
            <>
              <div className="border-b border-edge p-4">
                <div className="select-text font-medium text-ink">{detail.subject}</div>
                {detail.body && <div className="select-text mt-2 whitespace-pre-wrap text-xs text-ink-secondary">{detail.body}</div>}
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-muted"><span>{detail.author} &lt;{detail.email}&gt;</span><span>{shortDate(detail.date)}</span><button type="button" className="font-mono hover:text-ink" onClick={() => void navigator.clipboard.writeText(detail.hash)}>{detail.hash}</button></div>
              </div>
              <ChangedFiles files={detail.files} onSelect={selectCommitFile} />
            </>
          )}
        </div>
      )}

      {view.kind === 'diff' && <div className="min-h-0 flex-1 overflow-auto bg-surface-raised"><DiffView diff={diff} loading={diffLoading} /></div>}

      {menu && (
        <div className="fixed z-[1200] min-w-52 overflow-hidden rounded-lg border border-edge-bright bg-surface-raised py-1 text-xs shadow-xl" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 250) }} onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { void navigator.clipboard.writeText(menu.commit.hash); setMenu(null) }} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">{uiText("커밋 해시 복사")}</button>
          <button type="button" onClick={() => void act('branch', menu.commit)} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">{uiText("여기서 브랜치 생성")}</button>
          <button type="button" onClick={() => void act('tag', menu.commit)} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">{uiText("여기에 태그 생성")}</button>
          <button type="button" onClick={() => void act('checkout', menu.commit)} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">{uiText("이 커밋 checkout")}</button>
          <button type="button" onClick={() => void act('cherry-pick', menu.commit)} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">Cherry-pick</button>
          <button type="button" onClick={() => void act('revert', menu.commit)} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">{uiText("Revert 커밋 생성")}</button>
        </div>
      )}
    </div>
  )
}
