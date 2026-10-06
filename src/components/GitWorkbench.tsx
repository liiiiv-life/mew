import type { GitRemoteProgress } from '../../shared/git-remote-progress'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { HoverTipLayer, useDialog, useOverlayDismiss } from '@mew/ui'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Check, GitCommit, Github, OpenNewWindow, Page, SendDiagonal, Undo, Xmark } from 'iconoir-react'
import { relativeCommitTime } from '../utils/git-time'
import type { GitWorkbenchNavigation, GitWorkbenchView } from '../utils/git-workbench-navigation'
import { GitBranchPicker } from './git-branch-picker'
import { GitAiCommitDialog } from './git-ai-commit-dialog'
import {
  commitGitWorkingTree,
  discardGitWorkingTree,
  fetchGitCommit,
  fetchGitDiff,
  fetchGitLog,
  fetchGitRepository,
  fetchGitWorkingTree,
  fetchGitWorkingTreeDiff,
  runGitCommitAction,
  runGitRemoteAction,
  runGitBranchAction,
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

function statusColor(mark: string): string {
  switch (mark) {
    case 'A': case '?': return 'text-success-ink'
    case 'D': case 'U': return 'text-danger-ink'
    case 'M': case 'T': return 'text-warning-ink'
    case 'R': case 'C': return 'text-syntax-property'
    default: return 'text-ink-secondary'
  }
}

function ChangedFiles({ files, onSelect, compact = false, selected, onToggle, disabled }: { files: GitChangedFile[]; onSelect: (file: GitChangedFile) => void; compact?: boolean; selected?: Set<string>; onToggle?: (path: string) => void; disabled?: boolean }) {
  useUiLocale()
  const selectionDrag = useRef<{ pointerId: number; startY: number; startX: number; startIndex: number; checked: boolean; dragging: boolean; y: number; visited: Set<string> } | null>(null)
  const suppressClick = useRef(false)
  const scrollFrame = useRef<number | null>(null)
  const selectAtPointer = useRef<(list: HTMLDivElement, y: number) => void>(() => {})
  const stopAutoScroll = () => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current = null
  }
  useEffect(() => {
    selectionDrag.current = null
    stopAutoScroll()
    return stopAutoScroll
  }, [files, disabled])
  const selectRange = (index: number) => {
    const drag = selectionDrag.current
    if (!drag || !selected || !onToggle || disabled) return
    for (let i = Math.min(drag.startIndex, index); i <= Math.max(drag.startIndex, index); i++) {
      const path = files[i]?.path
      if (path === undefined || drag.visited.has(path)) continue
      drag.visited.add(path)
      if (selected.has(path) !== drag.checked) onToggle(path)
    }
  }
  useLayoutEffect(() => {
    selectAtPointer.current = (list, y) => {
      const scroll = list.closest<HTMLElement>('[data-git-scroll="changes"]')
      const viewport = scroll?.getBoundingClientRect()
      const visibleY = viewport ? Math.max(viewport.top, Math.min(viewport.bottom - 1, y)) : y
      const rows = list.querySelectorAll<HTMLElement>('[data-git-selection-row]')
      let index = 0
      rows.forEach((row, i) => {
        if (visibleY >= row.getBoundingClientRect().top) index = i
      })
      selectRange(index)
    }
  })
  const startAutoScroll = (list: HTMLDivElement) => {
    if (scrollFrame.current !== null) return
    const scroll = list.closest<HTMLElement>('[data-git-scroll="changes"]')
    if (!scroll) return
    let previousTime: number | null = null
    const tick = (time: number) => {
      scrollFrame.current = null
      const drag = selectionDrag.current
      if (!drag?.dragging) return
      const bounds = scroll.getBoundingClientRect()
      const edge = Math.min(40, bounds.height / 3)
      if (edge <= 0) return
      const strength = drag.y < bounds.top + edge
        ? -Math.min(1, (bounds.top + edge - drag.y) / edge)
        : drag.y > bounds.bottom - edge ? Math.min(1, (drag.y - bounds.bottom + edge) / edge) : 0
      if (!strength) return
      const elapsed = previousTime === null ? 16 : Math.min(32, time - previousTime)
      previousTime = time
      const before = scroll.scrollTop
      scroll.scrollTop += strength * elapsed * 0.48
      selectAtPointer.current(list, drag.y)
      if (scroll.scrollTop !== before) scrollFrame.current = requestAnimationFrame(tick)
    }
    scrollFrame.current = requestAnimationFrame(tick)
  }
  const moveSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = selectionDrag.current
    if (!drag || drag.pointerId !== event.pointerId || disabled) return
    if (!drag.dragging && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return
    drag.dragging = true
    drag.y = event.clientY
    suppressClick.current = true
    event.preventDefault()
    selectAtPointer.current(event.currentTarget, drag.y)
    startAutoScroll(event.currentTarget)
  }
  const finishSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (selectionDrag.current?.pointerId !== event.pointerId) return
    selectionDrag.current = null
    stopAutoScroll()
    if (event.type === 'pointercancel') suppressClick.current = false
  }
  if (files.length === 0) return <div className="p-6 text-center text-xs text-ink-muted">{uiText("변경된 파일이 없습니다.")}</div>
  return (
    <div className="divide-y divide-edge" onPointerMove={moveSelection} onPointerUp={event => { moveSelection(event); finishSelection(event) }} onPointerCancel={finishSelection} onLostPointerCapture={finishSelection}
      onClickCapture={event => { if (suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false } }}>
      {files.map((file, index) => (
        <div key={file.path} data-git-selection-row className="flex items-center">
          {selected && onToggle && <label className="flex shrink-0 cursor-pointer touch-none items-center self-stretch pl-3 pr-1"
            onPointerDown={event => {
              if (disabled || !event.isPrimary || event.button !== 0) return
              suppressClick.current = false
              selectionDrag.current = { pointerId: event.pointerId, startY: event.clientY, startX: event.clientX, startIndex: index, checked: !selected.has(file.path), dragging: false, y: event.clientY, visited: new Set() }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}>
            <input type="checkbox" checked={selected.has(file.path)} disabled={disabled} onChange={() => onToggle(file.path)} aria-label={uiText("{p0} 커밋에 포함", { p0: file.path })} className="h-4 w-4 accent-accent focus-visible:outline-2 focus-visible:outline-accent" />
          </label>}
          <button type="button" onClick={() => onSelect(file)} className={`flex min-w-0 flex-1 items-center text-left text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink ${compact ? 'gap-2 pr-3 py-1.5' : 'gap-3 pr-4 py-3'} ${selected && onToggle ? compact ? 'pl-1.5' : 'pl-2.5' : compact ? 'pl-3' : 'pl-4'}`}>
            <span className="shrink-0 rounded bg-surface-deep px-1 py-0.5 text-center font-mono text-[9px]" title={file.status}>
              {statusLabel(file.status).split('').map((mark, index) => <span key={index} className={statusColor(mark)}>{mark}</span>)}
            </span>
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

const CHANGES_MIN_HEIGHT = 36 + 28 * 1.5

function GitSplitHandle({ ratio, onChange, composerOpen }: { ratio: number; onChange: (ratio: number) => void; composerOpen: boolean }) {
  useUiLocale()
  const drag = useRef<{ pointerId: number; y: number; ratio: number; height: number } | null>(null)
  const handle = useRef<HTMLDivElement>(null)
  const [availableHeight, setAvailableHeight] = useState(0)
  useLayoutEffect(() => {
    const parent = handle.current?.parentElement
    if (!parent) return
    const measure = () => setAvailableHeight(Math.max(1, parent.clientHeight - 4))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])
  const maxRatio = composerOpen || !availableHeight ? 0.85 : Math.max(0.15, 1 - CHANGES_MIN_HEIGHT / availableHeight)
  const update = (value: number) => onChange(Math.max(0.15, Math.min(maxRatio, value)))
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (active?.pointerId === event.pointerId) update(active.ratio + (event.clientY - active.y) / active.height)
  }
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div ref={handle} role="separator" tabIndex={0} aria-label={uiText("커밋 기록과 변경사항 높이 조절")} aria-orientation="horizontal"
    aria-valuemin={15} aria-valuemax={Math.round(maxRatio * 100)} aria-valuenow={Math.round(ratio * 100)}
    className="relative z-10 h-1 shrink-0 cursor-row-resize touch-none bg-edge before:absolute before:-inset-y-1 before:inset-x-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    onKeyDown={(event) => {
      const next = event.key === 'ArrowUp' ? ratio - 0.05 : event.key === 'ArrowDown' ? ratio + 0.05 : event.key === 'Home' ? 0.15 : event.key === 'End' ? maxRatio : null
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

function GitComposer({ id, children, onSubmit }: { id: string; children: ReactNode; onSubmit: () => void }) {
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
  const minHeight = 128
  const maxHeight = Math.max(minHeight, Math.floor(availableHeight * 0.7))
  const clamp = (value: number) => Math.max(minHeight, Math.min(maxHeight, value))
  const visibleHeight = clamp(height ?? availableHeight / 3)
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (active?.pointerId === event.pointerId) setHeight(clamp(active.height + active.y - event.clientY))
  }
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <form id={id} ref={form} aria-label={uiText("커밋 작성")} className="relative min-h-32 shrink-0 border-t border-edge bg-surface-deep" style={{ height: visibleHeight }} onSubmit={event => { event.preventDefault(); onSubmit() }}>
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
    <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-auto p-2">{children}</div>
  </form>
}

export function GitWorkbench({ project, repositoryPath, onNotice, onBack, onOpenFile, branchHost, actionsHost, visible = true, navigation }: {
  project: string
  repositoryPath: string
  onNotice: (message: string) => void
  onBack?: () => void
  onOpenFile?: (project: string, path: string) => void
  branchHost?: HTMLElement | null
  actionsHost?: HTMLElement | null
  visible?: boolean
  navigation?: GitWorkbenchNavigation
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
  const [localView, setLocalView] = useState<GitWorkbenchView>({ kind: 'graph' })
  const view = navigation?.view ?? localView
  const setView = navigation?.onChange ?? setLocalView
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const [diff, setDiff] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [remoteAction, setRemoteAction] = useState<'pull' | 'push' | null>(null)
  const [remoteFeedback, setRemoteFeedback] = useState<{ action: 'pull' | 'push'; progress: GitRemoteProgress | null; complete: boolean } | null>(null)
  const remoteVersion = useRef(0)
  const remotePending = useRef(false)
  useEffect(() => {
    const invalidate = () => { remoteVersion.current++ }
    invalidate()
    setRemoteFeedback(null)
    setRemoteAction(null)
    remotePending.current = false
    return invalidate
  }, [project, repositoryPath])
  useEffect(() => {
    if (!remoteFeedback?.complete) return
    const timer = window.setTimeout(() => setRemoteFeedback(null), 3000)
    return () => window.clearTimeout(timer)
  }, [remoteFeedback])
  const [actionRunning, setActionRunning] = useState(false)
  const busy = committing || actionRunning || remoteAction !== null
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [commitTitle, setCommitTitle] = useState('')
  const [commitDescription, setCommitDescription] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const commitFormId = useId()
  const commitButtonRef = useRef<HTMLButtonElement>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const refreshVersion = useRef(0)
  const diffVersion = useRef(0)
  const polling = useRef(false)
  const [menu, setMenu] = useState<{ commit: GitLogEntry; x: number; y: number } | null>(null)
  useOverlayDismiss(menu ? () => setMenu(null) : false)
  const graph = useMemo(() => graphLayout(commits), [commits])
  const graphWidth = 16 + (graph.lanes - 1) * LANE_GAP

  const refresh = useCallback(async (selectAll = false) => {
    refreshVersion.current += 1
    setLoading(true)
    setError(null)
    setRefreshError(null)
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
      setSelectedFiles(current => new Set(nextWorkingTree.files.filter(file => selectAll ? file.currentIp === true : current.has(file.path)).map(file => file.path)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [project, repositoryPath, setView])

  useEffect(() => {
    setView({ kind: 'graph' })
    setCommitTitle('')
    setCommitDescription('')
    setComposerOpen(false)
    setSelectedFiles(new Set())
    setSplitRatio(0.2)
    setAiOpen(false)
    void refresh(true)
  }, [refresh, setView])

  useEffect(() => {
    if (!visible || loading || busy || !info?.repository) return
    let alive = true
    let timer: number | undefined
    const schedule = () => {
      window.clearTimeout(timer)
      if (alive && !document.hidden) timer = window.setTimeout(() => { void poll() }, 2_000)
    }
    const poll = async () => {
      window.clearTimeout(timer)
      if (!alive || document.hidden) return
      if (polling.current) { schedule(); return }
      polling.current = true
      const version = refreshVersion.current
      const current = () => alive && !document.hidden && version === refreshVersion.current
      try {
        const [next, log, nextInfo] = await Promise.all([
          fetchGitWorkingTree(repositoryPath, project),
          fetchGitLog(repositoryPath, project),
          fetchGitRepository(repositoryPath, project),
        ])
        if (!current()) return
        setCommits(previous => JSON.stringify(previous) === JSON.stringify(log.commits) ? previous : log.commits)
        setInfo(previous => JSON.stringify(previous) === JSON.stringify(nextInfo) ? previous : nextInfo)
        setWorkingTree(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
        setSelectedFiles(previous => {
          const paths = new Set(next.files.map(file => file.path))
          const kept = [...previous].filter(file => paths.has(file))
          return kept.length === previous.size ? previous : new Set(kept)
        })
        if (view.kind === 'diff' && view.source.kind === 'working') {
          // An already modified file can change again without changing its status.
          const request = ++diffVersion.current
          try {
            const result = next.files.some(file => file.path === view.file.path)
              ? await fetchGitWorkingTreeDiff(repositoryPath, view.file.path, project)
              : { diff: '' }
            if (!current() || request !== diffVersion.current) return
            setDiff(result.diff)
          } finally {
            if (current() && request === diffVersion.current) setDiffLoading(false)
          }
        }
        if (current()) setRefreshError(null)
      } catch (err) {
        if (current()) setRefreshError(err instanceof Error ? err.message : String(err))
      } finally {
        polling.current = false
        schedule()
      }
    }
    const resume = () => { void poll() }
    const visibilityChanged = () => {
      window.clearTimeout(timer)
      if (!document.hidden) resume()
    }
    void poll()
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      alive = false
      window.clearTimeout(timer)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [visible, loading, busy, info?.repository, project, repositoryPath, view])

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
    const requestVersion = ++diffVersion.current
    setDiff('')
    setDiffLoading(true)
    setError(null)
    const request = view.source.kind === 'working'
      ? fetchGitWorkingTreeDiff(repositoryPath, view.file.path, project)
      : fetchGitDiff(repositoryPath, view.source.hash, view.file.path, project)
    request
      .then((result) => { if (alive && requestVersion === diffVersion.current) setDiff(result.diff) })
      .catch((err: unknown) => { if (alive && requestVersion === diffVersion.current) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (alive && requestVersion === diffVersion.current) setDiffLoading(false) })
    return () => { alive = false }
  }, [project, repositoryPath, view])

  const goBack = () => {
    setError(null)
    if (navigation?.back()) return
    setView(view.kind === 'diff' && view.source.kind === 'commit' ? { kind: 'commit', hash: view.source.hash } : { kind: 'graph' })
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
      setComposerOpen(false)
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

  const discardPending = useRef(false)
  const discard = async () => {
    if (busy || discardPending.current || !selectedFiles.size || !info?.workspace) return
    discardPending.current = true
    const files = [...selectedFiles]
    const workspace = info.workspace
    setActionRunning(true)
    try {
      const confirmed = await dialogs.confirm({
        message: uiText('선택한 파일 {count}개의 변경사항을 취소할까요?', { count: files.length }),
        detail: uiText('커밋되지 않은 변경은 복구할 수 없습니다. 새 파일은 삭제됩니다.') + '\n\n' + files.join('\n'),
        confirmLabel: uiText('변경사항 취소'), danger: true,
      })
      if (!confirmed) return
      setError(null)
      await discardGitWorkingTree(repositoryPath, project, workspace, files)
      onNotice(uiText('선택한 변경사항을 취소했습니다'))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      discardPending.current = false
      setActionRunning(false)
    }
  }

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

  const changeBranch = async (action: 'switch' | 'create', ref: string, name?: string) => {
    if (busy || remotePending.current || loading || aiOpen || !info?.workspace) throw new Error(uiText('Git 작업이 이미 실행 중입니다'))
    remotePending.current = true
    refreshVersion.current++
    setActionRunning(true)
    setError(null)
    try {
      await runGitBranchAction(repositoryPath, action, ref, name, project, info.workspace)
      setView({ kind: 'graph' })
      await refresh()
    } finally {
      remotePending.current = false
      setActionRunning(false)
    }
  }

  const syncRemote = async (action: 'pull' | 'push') => {
    if (busy || remotePending.current || loading || aiOpen || !info?.repository || info.detached || !info.workspace) return
    remotePending.current = true
    const version = ++remoteVersion.current
    const current = () => remoteVersion.current === version
    setRemoteAction(action)
    setRemoteFeedback({ action, progress: null, complete: false })
    setError(null)
    try {
      await runGitRemoteAction(repositoryPath, action, project, info.workspace, progress => {
        if (current()) setRemoteFeedback({ action, progress, complete: false })
      })
      if (!current()) return
      setRemoteFeedback({ action, progress: null, complete: true })
      setView({ kind: 'graph' })
      await refresh()
    } catch (err) {
      if (!current()) return
      setRemoteFeedback(null)
      await refresh()
      if (current()) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (current()) {
        remotePending.current = false
        setRemoteAction(null)
      }
    }
  }

  const remoteText = (action: 'pull' | 'push') => {
    if (remoteFeedback?.action !== action) return ''
    if (remoteFeedback.complete) return uiText('완료')
    const progress = remoteFeedback.progress
    if (!progress || progress.phase === 'connecting') return action === 'push' ? uiText('Push 중…') : uiText('Pull 중…')
    if (progress.phase === 'waiting') return uiText('확인 중…')
    const phases = { counting: uiText('준비'), compressing: uiText('압축'), writing: uiText('전송'), receiving: uiText('수신'), resolving: uiText('정리') }
    return `${phases[progress.phase]} ${progress.percent ?? 0}%`
  }

  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface">
      {dialogs.dialog}
      {branchHost && createPortal(
        <GitBranchPicker key={`${project}:${repositoryPath}`} info={info} project={project} path={repositoryPath}
          disabled={!visible || loading || aiOpen || !info?.repository || !info.workspace} busy={busy} onAction={changeBranch} />, branchHost)}
      {actionsHost && createPortal(<>
        {(['pull', 'push'] as const).map(action => {
        const finished = remoteFeedback?.action === action && remoteFeedback.complete
        const status = remoteText(action)
        const Icon = finished ? Check : action === 'pull' ? ArrowDown : ArrowUp
        const label = action === 'pull' ? 'Pull' : 'Push'
        return <button key={action} type="button" title={status ? `${label}: ${status}` : label} aria-label={label} aria-busy={remoteAction === action}
          disabled={busy || loading || aiOpen || !info?.repository || info.detached || !info.workspace || !info.remotes?.length}
          onClick={() => { void syncRemote(action) }}
          className={`flex h-6 shrink-0 items-center justify-center gap-1 rounded hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent ${status ? 'px-1 text-[10px] text-accent' : 'w-6 text-ink-secondary hover:text-ink disabled:opacity-40'}`}>
          <Icon width={14} height={14} aria-hidden="true" className={remoteAction === action && !finished ? 'animate-pulse' : undefined} />
          {status && <span role="status" aria-live="polite" aria-atomic="true" className="whitespace-nowrap tabular-nums">{status}</span>}
        </button>
      })}
        {info?.originUrl && <a href={info.originUrl} target="_blank" rel="noopener noreferrer"
          title="origin" aria-label="origin"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
          {new URL(info.originUrl).hostname === 'github.com'
            ? <Github width={16} height={16} aria-hidden="true" />
            : <OpenNewWindow width={16} height={16} aria-hidden="true" />}
        </a>}
      </>, actionsHost)}
      {aiOpen && <GitAiCommitDialog key={project} project={project} files={[...selectedFiles]} onClose={() => { setAiOpen(false); void refresh() }} onFinished={() => { void refresh() }} />}
      {(view.kind !== 'graph' || onBack) && <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge bg-surface-deep px-3">
        {(view.kind !== 'graph' || onBack) && <button type="button" onClick={view.kind === 'graph' ? onBack : goBack} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover hover:text-ink" aria-label={view.kind === 'graph' ? uiText("저장소 목록") : uiText("뒤로 가기")} title={view.kind === 'graph' ? uiText("저장소 목록") : uiText("뒤로 가기")}><BackIcon /></button>}
        <span className={`min-w-0 flex-1 truncate font-semibold text-ink ${view.kind === 'diff' ? 'text-[10px]' : 'text-sm'}`} title={heading}>{heading}</span>
        {view.kind === 'diff' && onOpenFile && <button type="button" onClick={() => onOpenFile(project, [repositoryPath, view.file.path].filter(Boolean).join('/'))}
          disabled={view.file.status.includes('D')} aria-label={uiText("파일 열기")} title={uiText("파일 열기")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 disabled:pointer-events-none">
          <Page width={16} height={16} aria-hidden="true" />
        </button>}
      </div>}

      {(error || refreshError) && <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-danger/10 px-3 py-2 text-xs text-danger"><span className="select-text min-w-0 flex-1">{error || refreshError}</span><button type="button" onClick={() => { setError(null); setRefreshError(null) }} aria-label={uiText("오류 닫기")}>×</button></div>}

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
                    className="flex w-full items-center gap-2 pr-2 text-left text-[11px] hover:bg-surface-hover focus-visible:outline-accent"
                    style={{ height: ROW_HEIGHT, minWidth: graphWidth + 220 }}
                  >
                    <GraphCell row={graph.rows[index]} width={graphWidth} />
                    <span className="min-w-16 flex-1 truncate text-ink">{entry.subject}</span>
                    {entry.refs.length > 0 && <span className="hidden max-w-24 shrink-0 truncate rounded bg-surface-deep px-1 text-[9px] text-accent @min-[480px]:inline">{entry.refs[0].replace(/^HEAD -> /, '')}{entry.refs.length > 1 ? ` +${entry.refs.length - 1}` : ''}</span>}
                    <time dateTime={entry.date} className="shrink-0 whitespace-nowrap text-[10px] tabular-nums text-ink-secondary">{relativeCommitTime(entry.date, now)}</time>
                    <span className="shrink-0 font-mono text-[10px] text-ink-secondary">{entry.hash.slice(0, 7)}</span>
                    <span className="max-w-12 shrink-0 truncate text-[10px] text-ink-secondary @min-[480px]:max-w-20">{entry.author}</span>
                  </button>
                ))}
              </div>
            </section>
            <GitSplitHandle ratio={splitRatio} onChange={setSplitRatio} composerOpen={composerOpen} />
            <section aria-label={uiText("현재 변경사항")} className="flex min-h-0 flex-col overflow-hidden" style={{ flex: `${1 - splitRatio} 1 0`, minHeight: `min(${composerOpen ? 224 : CHANGES_MIN_HEIGHT}px, 75%)` }}>
              <div className="flex h-9 shrink-0 items-center gap-2 border-b border-edge px-3 text-xs">
                <input type="checkbox" aria-label={uiText("변경 파일 전체 선택")} checked={workingTree.files.length > 0 && selectedFiles.size === workingTree.files.length} ref={node => { if (node) node.indeterminate = selectedFiles.size > 0 && selectedFiles.size < workingTree.files.length }} disabled={busy || workingTree.files.length === 0} onChange={event => setSelectedFiles(new Set(event.target.checked ? workingTree.files.map(file => file.path) : []))} className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-accent" />
                <span className="shrink-0 whitespace-nowrap tabular-nums text-ink-muted"><span role="status" aria-label={uiText("{count}개 선택", { count: selectedFiles.size })}>{selectedFiles.size}</span> / {workingTree.files.length}</span>
                <span className="min-w-0 truncate font-medium text-ink">{uiText("변경사항")}</span>
                <HoverTipLayer className="ml-auto flex shrink-0 items-center gap-1.5">
                  <button type="button" onClick={() => void discard()} disabled={busy || selectedFiles.size === 0} aria-label={uiText('선택한 변경사항 취소')} data-tip={uiText('선택한 변경사항 취소')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-edge-strong text-ink-secondary hover:bg-surface-hover hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40">
                    <Undo width={14} height={14} aria-hidden="true" />
                  </button>
                  <button ref={commitButtonRef} type="button" onClick={() => { if (composerOpen) void commit(); else setComposerOpen(true) }} disabled={busy || (composerOpen && (!commitTitle.trim() || selectedFiles.size === 0))} aria-expanded={composerOpen} aria-controls={composerOpen ? commitFormId : undefined} aria-label={committing ? uiText("커밋 중…") : uiText("커밋")} data-tip={committing ? uiText("커밋 중…") : uiText("커밋")} className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent text-ink-on-accent hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40">
                    <GitCommit width={14} height={14} aria-hidden="true" />
                  </button>
                  {view.kind === 'graph' && info?.repository && <button type="button" disabled={busy} onClick={() => setAiOpen(true)} aria-label={uiText("AI 자동 커밋")} data-tip={uiText("AI 자동 커밋")} className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-edge-strong text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40">
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 3v4M3 12v5m18-5v5" />
                      <rect x="5" y="7" width="14" height="14" rx="3" />
                      <path d="M9 12v2m6-2v2m-6 3h6" />
                    </svg>
                  </button>}
                </HoverTipLayer>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-git-scroll="changes">
                <ChangedFiles compact files={workingTree.files} selected={selectedFiles} disabled={busy} onToggle={path => setSelectedFiles(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next })} onSelect={(file) => setView({ kind: 'diff', source: { kind: 'working' }, file })} />
              </div>
              {composerOpen && <GitComposer id={commitFormId} onSubmit={() => { void commit() }}>
                <HoverTipLayer className="flex shrink-0 items-center gap-1.5">
                  <input autoFocus value={commitTitle} disabled={busy} onChange={(event) => setCommitTitle(event.target.value)} maxLength={500} placeholder={uiText("커밋 제목")} aria-label={uiText("커밋 제목")} className="h-7 min-w-0 flex-1 rounded border border-edge bg-surface px-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent" />
                  <button type="submit" disabled={busy || !commitTitle.trim() || selectedFiles.size === 0} aria-label={committing ? uiText("커밋 중…") : uiText("전송")} data-tip={committing ? uiText("커밋 중…") : uiText("전송")} className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent text-ink-on-accent hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40">
                    <SendDiagonal width={14} height={14} aria-hidden="true" />
                  </button>
                  <button type="button" disabled={busy} onClick={() => { setComposerOpen(false); requestAnimationFrame(() => commitButtonRef.current?.focus()) }} aria-label={uiText("닫기")} data-tip={uiText("닫기")} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40">
                    <Xmark width={14} height={14} aria-hidden="true" />
                  </button>
                </HoverTipLayer>
                <textarea value={commitDescription} disabled={busy} onChange={(event) => setCommitDescription(event.target.value)} maxLength={20000} placeholder={uiText("설명 (선택)")} aria-label={uiText("커밋 설명")} className="min-h-7 w-full flex-1 resize-none rounded border border-edge bg-surface px-2 py-1.5 text-xs text-ink outline-none placeholder:text-ink-muted focus:border-accent" />
              </GitComposer>}
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
