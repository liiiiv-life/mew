import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDialog, useOverlayDismiss } from '@mew/ui'
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
  type GitChangedFile,
  type GitCommitAction,
  type GitCommitDetail,
  type GitLogEntry,
  type GitRepositoryInfo,
  type GitWorkingTreeDetail,
} from '../api/client'

const LANE_GAP = 14
const ROW_HEIGHT = 58
const GRAPH_COLORS = ['#5da9ff', '#f28b82', '#81c995', '#fdd663', '#c58af9', '#78d9ec', '#ff8bcb']

type GraphEdge = { from: number; to: number; commit: boolean }
type GraphRow = { lane: number; before: number; after: number; edges: GraphEdge[] }
type DetailSource = { kind: 'working' } | { kind: 'commit'; hash: string }
type WorkbenchView =
  | { kind: 'graph' }
  | { kind: 'working' }
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
  const x = (lane: number) => 10 + lane * LANE_GAP
  const mid = ROW_HEIGHT / 2
  return (
    <svg width={width} height={ROW_HEIGHT} className="block shrink-0" aria-hidden="true">
      {Array.from({ length: row.before }, (_, lane) => (
        <path key={`top-${lane}`} d={`M ${x(lane)} 0 L ${x(lane)} ${mid}`} stroke={GRAPH_COLORS[lane % GRAPH_COLORS.length]} strokeWidth="2" fill="none" />
      ))}
      {row.edges.map((edge, index) => (
        <path
          key={`${edge.from}-${edge.to}-${index}`}
          d={`M ${x(edge.from)} ${edge.commit ? mid : 0} C ${x(edge.from)} ${mid}, ${x(edge.to)} ${mid}, ${x(edge.to)} ${ROW_HEIGHT}`}
          stroke={GRAPH_COLORS[edge.from % GRAPH_COLORS.length]}
          strokeWidth="2"
          fill="none"
        />
      ))}
      <circle cx={x(row.lane)} cy={mid} r="4.5" fill={GRAPH_COLORS[row.lane % GRAPH_COLORS.length]} stroke="var(--color-surface-raised)" strokeWidth="2" />
    </svg>
  )
}

function WorkingTreeGraphCell({ width, continues }: { width: number; continues: boolean }) {
  return (
    <svg width={width} height={ROW_HEIGHT} className="block shrink-0" aria-hidden="true">
      {continues && <path d={`M 10 ${ROW_HEIGHT / 2} L 10 ${ROW_HEIGHT}`} stroke={GRAPH_COLORS[0]} strokeWidth="2" />}
      <circle cx="10" cy={ROW_HEIGHT / 2} r="5" fill="var(--color-warning-ink)" stroke="var(--color-surface-raised)" strokeWidth="2" />
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
  const lines = useMemo(() => parseDiff(diff), [diff])
  if (loading) return <div className="p-5 text-center text-xs text-ink-muted">diff를 불러오는 중…</div>
  if (!diff) return <div className="p-5 text-center text-xs text-ink-muted">표시할 변경 내용이 없습니다.</div>
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

function ChangedFiles({ files, onSelect }: { files: GitChangedFile[]; onSelect: (file: GitChangedFile) => void }) {
  if (files.length === 0) return <div className="p-6 text-center text-xs text-ink-muted">변경된 파일이 없습니다.</div>
  return (
    <div className="divide-y divide-edge">
      {files.map((file) => (
        <button key={`${file.status}:${file.previousPath ?? ''}:${file.path}`} type="button" onClick={() => onSelect(file)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink">
          <span className="w-7 shrink-0 rounded bg-surface-deep py-0.5 text-center font-mono text-[9px] text-accent" title={file.status}>{statusLabel(file.status)}</span>
          <span className="min-w-0 flex-1 truncate">{file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}</span>
          <span className="text-ink-muted" aria-hidden="true">›</span>
        </button>
      ))}
    </div>
  )
}

function BackIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
}

export function GitWorkbench({ project, repositoryPath, onNotice, onBack }: {
  project: string
  repositoryPath: string
  onNotice: (message: string) => void
  onBack?: () => void
}) {
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
  const [commitTitle, setCommitTitle] = useState('')
  const [commitDescription, setCommitDescription] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ commit: GitLogEntry; x: number; y: number } | null>(null)
  useOverlayDismiss(menu ? () => setMenu(null) : false)
  const graph = useMemo(() => graphLayout(commits), [commits])
  const graphWidth = 20 + graph.lanes * LANE_GAP

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
      setCommits(log.commits)
      setWorkingTree(nextWorkingTree)
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
      if (current.kind === 'diff') return current.source.kind === 'working' ? { kind: 'working' } : { kind: 'commit', hash: current.source.hash }
      return { kind: 'graph' }
    })
  }

  const selectCommitFile = (file: GitChangedFile) => {
    if (view.kind !== 'commit') return
    setView({ kind: 'diff', source: { kind: 'commit', hash: view.hash }, file })
  }

  const commit = async () => {
    if (!commitTitle.trim() || workingTree.files.length === 0 || committing) return
    setCommitting(true)
    setError(null)
    try {
      await commitGitWorkingTree(repositoryPath, commitTitle, commitDescription, project)
      setCommitTitle('')
      setCommitDescription('')
      setView({ kind: 'graph' })
      onNotice('변경사항을 커밋했습니다')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCommitting(false)
    }
  }

  const dialogs = useDialog()

  const act = async (action: GitCommitAction, selected: GitLogEntry) => {
    setMenu(null)
    let name: string | undefined
    if (action === 'branch') {
      name = (await dialogs.prompt({ message: '브랜치 만들기', label: '브랜치 이름', detail: `${selected.hash.slice(0, 8)}에서 생성`, confirmLabel: '만들기' }))?.trim()
      if (!name) return
    } else if (action === 'tag') {
      name = (await dialogs.prompt({ message: '태그 만들기', label: '태그 이름', detail: `${selected.hash.slice(0, 8)}에 생성`, confirmLabel: '만들기' }))?.trim()
      if (!name) return
    } else {
      const labels: Record<Exclude<GitCommitAction, 'branch' | 'tag'>, string> = { checkout: '이 커밋을 detached HEAD로 checkout', 'cherry-pick': '현재 브랜치에 cherry-pick', revert: '현재 브랜치에서 revert 커밋 생성' }
      if (!(await dialogs.confirm({ message: `${labels[action]}할까요?`, detail: `${selected.hash.slice(0, 8)} ${selected.subject}`, confirmLabel: '실행', danger: true }))) return
    }
    try {
      await runGitCommitAction(repositoryPath, action, selected.hash, name, project)
      onNotice('Git 작업을 완료했습니다')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const heading = view.kind === 'graph'
    ? ''
    : view.kind === 'working'
      ? '커밋되지 않은 변경사항'
      : view.kind === 'commit'
        ? detail?.subject ?? '커밋 상세'
        : view.file.path

  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface">
      {dialogs.dialog}
      {aiOpen && <GitAiCommitDialog key={project} project={project} onClose={() => setAiOpen(false)} onApply={draft => {
        setCommitTitle(draft.title)
        setCommitDescription(draft.description)
        setAiOpen(false)
        onNotice('커밋 초안을 적용했습니다. 내용을 확인한 뒤 커밋하세요.')
      }} />}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge bg-surface-deep px-3">
        {(view.kind !== 'graph' || onBack) && <button type="button" onClick={view.kind === 'graph' ? onBack : goBack} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover hover:text-ink" aria-label={view.kind === 'graph' ? '저장소 목록' : '뒤로 가기'} title={view.kind === 'graph' ? '저장소 목록' : '뒤로 가기'}><BackIcon /></button>}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={heading}>{heading}</span>
      </div>

      {error && <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-danger/10 px-3 py-2 text-xs text-danger"><span className="select-text min-w-0 flex-1">{error}</span><button type="button" onClick={() => setError(null)} aria-label="오류 닫기">×</button></div>}

      {view.kind === 'graph' && (
        <>
          <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-edge px-3 py-1 text-xs">
            <span className="min-w-0 truncate font-semibold text-ink" title={repositoryPath}>{repositoryPath || (project === 'docs' ? 'Documents' : '프로젝트 루트')}</span>
            {info?.branch && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">{info.branch}</span>}
            {info?.detached && <span className="rounded bg-warning-surface px-1.5 py-0.5 text-warning-ink">detached</span>}
            {!!info?.ahead && <span className="text-ink-muted">↑{info.ahead}</span>}
            {!!info?.behind && <span className="text-ink-muted">↓{info.behind}</span>}
            <button type="button" onClick={() => void refresh()} disabled={loading} className="ml-auto rounded px-2 py-1 text-ink-secondary hover:bg-surface-hover disabled:opacity-40">새로고침</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-5 text-center text-xs text-ink-muted">커밋을 불러오는 중…</div>
            ) : info?.repository === false ? (
              <p role="status" className="p-5 text-center text-sm text-ink-secondary">현재 프로젝트에 Git 저장소가 없습니다.</p>
            ) : error ? (
              <button type="button" onClick={() => void refresh()} className="m-5 rounded border border-edge-strong px-3 py-2 text-sm text-ink hover:bg-surface-hover">다시 시도</button>
            ) : (
              <>
                <button type="button" onClick={() => setView({ kind: 'working' })} className="flex h-[58px] w-full items-stretch border-b border-edge bg-warning-surface/25 text-left text-xs hover:bg-surface-hover">
                  <WorkingTreeGraphCell width={graphWidth} continues={commits.length > 0} />
                  <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 pr-3">
                    <span className="font-medium text-ink">커밋되지 않은 변경사항</span>
                    <span className="text-[10px] text-ink-muted">{workingTree.files.length > 0 ? `${workingTree.files.length}개 파일 변경됨` : '변경 없음'}</span>
                  </span>
                  <span className="flex items-center pr-3 text-ink-muted" aria-hidden="true">›</span>
                </button>
                {commits.length === 0 ? (
                  <div className="p-5 text-center text-xs text-ink-muted">아직 커밋이 없습니다</div>
                ) : commits.map((entry, index) => (
                  <button
                    key={entry.hash}
                    type="button"
                    onClick={() => setView({ kind: 'commit', hash: entry.hash })}
                    onContextMenu={(event) => { event.preventDefault(); setMenu({ commit: entry, x: event.clientX, y: event.clientY }) }}
                    className="flex h-[58px] w-full items-stretch border-b border-edge text-left text-xs hover:bg-surface-hover"
                  >
                    <GraphCell row={graph.rows[index]} width={graphWidth} />
                    <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 pr-3">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-medium text-ink">{entry.subject}</span>
                        {entry.refs.slice(0, 3).map((ref) => <span key={ref} className="max-w-28 shrink-0 truncate rounded bg-surface-deep px-1 py-0.5 text-[9px] text-accent">{ref.replace(/^HEAD -> /, '')}</span>)}
                      </span>
                      <span className="flex items-center gap-2 text-[10px] text-ink-muted"><span>{entry.author}</span><span>{shortDate(entry.date)}</span><span className="font-mono">{entry.hash.slice(0, 8)}</span></span>
                    </span>
                    <span className="flex items-center pr-3 text-ink-muted" aria-hidden="true">›</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}

      {view.kind === 'working' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ChangedFiles files={workingTree.files} onSelect={(file) => setView({ kind: 'diff', source: { kind: 'working' }, file })} />
          </div>
          <form className="shrink-0 space-y-2 border-t border-edge bg-surface-deep p-4" onSubmit={(event) => { event.preventDefault(); void commit() }}>
            <input value={commitTitle} onChange={(event) => setCommitTitle(event.target.value)} maxLength={500} placeholder="커밋 제목" aria-label="커밋 제목" className="w-full rounded border border-edge-strong bg-surface-deep px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent" />
            <textarea value={commitDescription} onChange={(event) => setCommitDescription(event.target.value)} maxLength={20000} rows={3} placeholder="설명 (선택)" aria-label="커밋 설명" className="w-full resize-y rounded border border-edge-strong bg-surface-deep px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-muted focus:border-accent" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-ink-muted">변경 파일 {workingTree.files.length}개를 모두 커밋합니다.</span>
              <span className="flex shrink-0 items-center gap-2">
                <button type="button" disabled={workingTree.files.length === 0 || committing} onClick={() => setAiOpen(true)} className="rounded border border-edge-strong px-4 py-2 text-xs font-medium text-ink-secondary hover:bg-surface-hover hover:text-ink disabled:opacity-40">AI Commit</button>
                <button type="submit" disabled={!commitTitle.trim() || workingTree.files.length === 0 || committing} className="rounded bg-accent px-4 py-2 text-xs font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40">{committing ? '커밋 중…' : '커밋'}</button>
              </span>
            </div>
          </form>
        </div>
      )}

      {view.kind === 'commit' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {detailLoading ? (
            <div className="p-5 text-center text-xs text-ink-muted">커밋을 불러오는 중…</div>
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
          <button type="button" onClick={() => { void navigator.clipboard.writeText(menu.commit.hash); setMenu(null) }} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">커밋 해시 복사</button>
          <button type="button" onClick={() => void act('branch', menu.commit)} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">여기서 브랜치 생성</button>
          <button type="button" onClick={() => void act('tag', menu.commit)} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">여기에 태그 생성</button>
          <button type="button" onClick={() => void act('checkout', menu.commit)} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">이 커밋 checkout</button>
          <button type="button" onClick={() => void act('cherry-pick', menu.commit)} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">Cherry-pick</button>
          <button type="button" onClick={() => void act('revert', menu.commit)} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">Revert 커밋 생성</button>
        </div>
      )}
    </div>
  )
}
