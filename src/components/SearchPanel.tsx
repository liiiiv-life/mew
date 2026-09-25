import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useDialog } from '@mew/ui'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
  replaceInProjectFile,
  searchFileNames,
  searchProjectStream,
  type SearchFileResult,
  type SearchMatch,
  type SearchOptions,
} from '../api/client'
import { ProjectIcon } from './ProjectIcon'
import type { FileSearchResult } from './FileTree'
import { useI18n } from '../i18n'

export interface SearchScopeOption {
  id: string
  label: string
  icon: string
}

// VSCode식 프로젝트 전체 검색 패널(Ctrl+Shift+F) — 사이드바에 뜨며 찾기·바꾸기·정규식을 지원한다.
// 파일별로 매치를 접을 수 있고, 매치를 클릭하면 해당 파일을 열어 그 위치를 강조한다.

export function SearchPanel({
  focusSignal,
  readOnly,
  project,
  scopes,
  mode,
  onOpenFileNameResult,
  onOpenResult,
  onReplaced,
}: {
  /** Ctrl+Shift+F가 눌릴 때마다 증가 — 입력창을 포커스한다 */
  focusSignal: number
  /** 게스트면 바꾸기 UI를 숨긴다 */
  readOnly: boolean
  /** 검색 API의 기준 프로젝트. 로그인 사용자는 .workspace로 통합 검색한다. */
  project: string
  /** @로 고를 수 있는 Documents·직계 하위 프로젝트 */
  scopes: SearchScopeOption[]
  mode: 'files' | 'content'
  onOpenFileNameResult?: (result: FileSearchResult) => void
  onOpenResult: (path: string, match: SearchMatch, query: string, opts: SearchOptions, project?: string) => void
  /** 치환이 끝난 뒤 (트리·열린 파일 새로고침용) */
  onReplaced: () => void
}) {
  useUiLocale()
  const { t } = useI18n()
  const dialogs = useDialog()
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [selectedScopes, setSelectedScopes] = useState<string[]>([])
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false)
  const [results, setResults] = useState<SearchFileResult[]>([])
  const [fileResults, setFileResults] = useState<FileSearchResult[]>([])
  const [truncated, setTruncated] = useState(false)
  const [indexState, setIndexState] = useState<'ready' | 'building' | 'stale' | 'disabled'>('ready')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, toggleCollapsed] = useReducer((set: Set<string>, path: string) => {
    const next = new Set(set)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  }, new Set<string>())
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reqIdRef = useRef(0)
  const streamAbortRef = useRef<AbortController | null>(null)

  const opts: SearchOptions = { regex, caseSensitive, scopes: selectedScopes }

  const run = useCallback(
    (q: string, o: SearchOptions) => {
      streamAbortRef.current?.abort()
      streamAbortRef.current = null
      const id = ++reqIdRef.current
      if (!q) {
        setResults([])
        setFileResults([])
        setTruncated(false)
        setIndexState('ready')
        setError(null)
        setLoading(false)
        return
      }
      setLoading(true)
      if (mode === 'content') setResults([])
      const streamAbort = new AbortController()
      streamAbortRef.current = streamAbort
      let pendingResults: SearchFileResult[] = []
      let resultTimer: ReturnType<typeof setTimeout> | null = null
      const flushResults = () => {
        if (resultTimer) clearTimeout(resultTimer)
        resultTimer = null
        if (!pendingResults.length || id !== reqIdRef.current) { pendingResults = []; return }
        const next = pendingResults
        pendingResults = []
        setResults((current) => [...current, ...next])
      }
      const queueResult = (result: SearchFileResult) => {
        pendingResults.push(result)
        if (pendingResults.length >= 20) flushResults()
        else if (!resultTimer) resultTimer = setTimeout(flushResults, 50)
      }
      const request = mode === 'files'
        ? searchFileNames(q, o, streamAbort.signal)
        : searchProjectStream(q, o, project, queueResult, streamAbort.signal)
      request
        .then((res) => {
          if (id !== reqIdRef.current) return // 더 최신 요청이 있으면 버린다
          flushResults()
          if (mode === 'files') {
            setFileResults([])
            setResults([])
            setTruncated(false)
            const fileResponse = res as Awaited<ReturnType<typeof searchFileNames>>
            setFileResults(fileResponse.results.map((result) => {
              const scope = scopes.find((item) => item.id === result.scope.id)
              return scope ? { ...result, scope: { ...result.scope, label: scope.label, icon: scope.icon } } : result
            }))
            setIndexState(fileResponse.state)
          } else {
            const content = res as Awaited<ReturnType<typeof searchProjectStream>>
            setFileResults([])
            setTruncated(content.truncated)
            setIndexState(content.state)
          }
          setError(null)
        })
        .catch((err) => {
          if (id !== reqIdRef.current) return
          setResults([])
          setError(err instanceof Error ? err.message : uiText("검색 실패"))
        })
        .finally(() => {
          if (resultTimer) clearTimeout(resultTimer)
          if (id === reqIdRef.current) {
            streamAbortRef.current = null
            setLoading(false)
          }
        })
    },
    [mode, project, scopes],
  )

  // 검색어·옵션 변경 시 디바운스 후 검색
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => run(query, opts), 250)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, regex, caseSensitive, selectedScopes, mode])

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusSignal])

  useEffect(() => () => streamAbortRef.current?.abort(), [])

  const totalMatches = results.reduce((n, r) => n + r.matches.length, 0)

  async function replaceAllInFile(file: SearchFileResult) {
    if (busy) return
    setBusy(true)
    try {
      await replaceInProjectFile(file.path, query, replace, opts, file.project?.id)
      onReplaced()
      run(query, opts)
    } catch (err) {
      setError(err instanceof Error ? err.message : uiText("바꾸기 실패"))
    } finally {
      setBusy(false)
    }
  }

  async function replaceAll() {
    if (busy || !results.length) return
    if (!(await dialogs.confirm({ message: uiText("모두 바꾸고 커밋할까요?"), detail: uiText("{p0}개 파일에서 {p1}개 매치를 \"{p2}\"(으)로 바꿉니다.", { p0: results.length, p1: totalMatches, p2: replace }), confirmLabel: uiText("모두 바꾸기"), danger: true }))) return
    setBusy(true)
    try {
      for (const file of results) {
        await replaceInProjectFile(file.path, query, replace, opts, file.project?.id)
      }
      onReplaced()
      run(query, opts)
    } catch (err) {
      setError(err instanceof Error ? err.message : uiText("바꾸기 실패"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      {dialogs.dialog}
      <div className="flex items-start gap-1 border-b border-edge px-2 py-2">
        {mode === 'content' && <button
          type="button"
          onClick={() => setShowReplace((v) => !v)}
          className="mt-1 rounded p-1 text-ink-muted hover:bg-surface-hover"
          title={showReplace ? uiText("바꾸기 접기") : uiText("바꾸기 펼치기")}
          aria-label={uiText("바꾸기 토글")}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showReplace ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}>
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="relative flex flex-wrap items-center gap-1 rounded border border-edge-strong bg-surface-deep px-1.5 py-1 focus-within:border-accent">
            {selectedScopes.map((id) => {
              const scope = scopes.find((item) => item.id === id)
              if (!scope) return null
              return <span key={id} className="flex max-w-full items-center gap-1 rounded bg-accent/20 px-1 py-0.5 text-xs text-ink">
                <ProjectIcon icon={scope.icon} size={12} />
                <span className="truncate">{scope.label}</span>
                <button type="button" className="rounded text-ink-muted hover:text-ink" onClick={() => setSelectedScopes((items) => items.filter((item) => item !== id))} aria-label={uiText("{p0} 범위 제거", { p0: scope.label })}>×</button>
              </span>
            })}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === 'files' ? t('search.fileNamePlaceholder') : t('search.fileContentPlaceholder')}
              onKeyDown={(event) => {
                if (event.key === '@' && scopes.length) {
                  event.preventDefault()
                  setScopeMenuOpen(true)
                }
              }}
              className="min-w-[4rem] flex-1 bg-transparent py-0.5 text-sm text-ink outline-none placeholder:text-ink-faint"
              spellCheck={false}
            />
            <button type="button" onClick={() => setCaseSensitive((v) => !v)} className={`m-0.5 rounded px-1 py-0.5 text-xs font-mono ${caseSensitive ? 'bg-accent text-ink-on-accent' : 'text-ink-muted hover:bg-surface-hover'}`} title={uiText("대소문자 구분")}>Aa</button>
            <button type="button" onClick={() => setRegex((v) => !v)} className={`m-0.5 rounded px-1 py-0.5 text-xs font-mono ${regex ? 'bg-accent text-ink-on-accent' : 'text-ink-muted hover:bg-surface-hover'}`} title={uiText("정규식 사용")}>.*</button>
            {scopeMenuOpen && (
              <div className="absolute left-0 top-full z-30 mt-1 max-h-64 min-w-[15rem] overflow-y-auto rounded-lg border border-edge-bright bg-surface-raised py-1 shadow-xl">
                <div className="px-2.5 py-1 text-[10px] text-ink-faint">{uiText("검색할 범위 · 여러 개를 골라 OR로 검색")}</div>
                {scopes.map((scope) => {
                  const selected = selectedScopes.includes(scope.id)
                  return <button key={scope.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setSelectedScopes((items) => selected ? items.filter((item) => item !== scope.id) : [...items, scope.id])} className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs ${selected ? 'bg-surface-hover text-ink' : 'text-ink-secondary hover:bg-surface-hover'}`}>
                    <ProjectIcon icon={scope.icon} size={14} />
                    <span className="flex-1 truncate">{scope.label}</span>
                    {selected && <span className="text-accent">✓</span>}
                  </button>
                })}
                <button type="button" onClick={() => setScopeMenuOpen(false)} className="w-full border-t border-edge px-2.5 py-1.5 text-left text-xs text-ink-muted hover:bg-surface-hover">{uiText("완료")}</button>
              </div>
            )}
          </div>
          {mode === 'content' && showReplace && !readOnly && (
            <div className="flex items-center gap-1">
              <div className="flex min-w-0 flex-1 items-center rounded border border-edge-strong bg-surface-deep pl-1.5 focus-within:border-accent">
                <input
                  value={replace}
                  onChange={(e) => setReplace(e.target.value)}
                  placeholder={uiText("바꾸기")}
                  className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-faint"
                  spellCheck={false}
                />
              </div>
              <button
                type="button"
                onClick={replaceAll}
                disabled={busy || !results.length}
                className="rounded px-1.5 py-1 text-xs text-ink-muted enabled:hover:bg-surface-hover disabled:opacity-40"
                title={uiText("모든 파일에서 모두 바꾸기 (커밋)")}
              >
                {uiText("모두")}</button>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="select-text px-3 py-2 text-xs text-danger-strong">{error}</div>}
        {!error && loading && <div className="px-3 py-2 text-xs text-ink-muted">{uiText("검색 중…")}</div>}
        {!error && mode === 'content' && indexState !== 'ready' && query && (
          <div className="px-3 py-1 text-xs text-ink-muted">
            {indexState === 'building' ? uiText("색인 준비 중 — 정확 검색으로 보완 중") : indexState === 'disabled' ? uiText("정확 검색 색인 꺼짐 — 원문 검색 중") : uiText("색인 복구 중 — 원문 검색으로 보완 중")}
          </div>
        )}
        {!error && query && !loading && (mode === 'files' ? fileResults.length === 0 : results.length === 0) && (
          <div className="px-3 py-2 text-xs text-ink-muted">{uiText("결과 없음")}</div>
        )}
        {!error && query && mode === 'content' && (
          <div className="px-3 py-1 text-xs text-ink-muted">
            {uiText("검색 결과 {matches}개 · 파일 {files}개", { matches: totalMatches, files: results.length })}{truncated ? uiText(" (일부만 표시)") : ''}
          </div>
        )}
        {mode === 'files' && fileResults.map((file) => <button key={`${file.project}:${file.path}`} type="button" onClick={() => onOpenFileNameResult?.(file)} className="group relative flex w-full items-center gap-1.5 px-2 py-1 text-left text-sm text-ink hover:bg-surface-hover"><ProjectIcon icon={file.scope.icon} size={14} /><span className="min-w-0 flex-1 truncate">{file.path}</span><FileNamePathTooltip file={file} /></button>)}
        {mode === 'content' && results.map((file) => {
          const resultKey = searchResultKey(file, project)
          const isCollapsed = collapsed.has(resultKey)
          return (
            <div key={resultKey}>
              <div className="group relative flex items-center gap-1 px-2 py-0.5 hover:bg-surface-hover">
                {file.project && <ProjectIcon icon={file.project.kind === 'docs' ? 'i:notes' : file.project.kind === 'subproject' ? (scopes.find((scope) => scope.label === file.project!.label)?.icon ?? 'i:folder') : 'i:folder'} size={14} />}
                <button type="button" onClick={() => toggleCollapsed(resultKey)} className="rounded p-0.5 text-ink-muted" aria-label={uiText("접기/펼치기")}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isCollapsed ? 'none' : 'rotate(90deg)', transition: 'transform 0.1s' }}>
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-secondary">{fileName(file.path)}</span>
                <span className="text-xs text-ink-faint" title={file.path}>{dirName(file.path)}</span>
                <span className="ml-1 rounded-full bg-surface-raised px-1.5 text-[10px] text-ink-muted">{file.matches.length}</span>
                {showReplace && !readOnly && (
                  <button
                    type="button"
                    onClick={() => replaceAllInFile(file)}
                    disabled={busy}
                    className="hidden rounded p-0.5 text-ink-muted enabled:hover:bg-surface-hover disabled:opacity-40 group-hover:block"
                    title={uiText("이 파일에서 모두 바꾸기")}
                    aria-label={uiText("이 파일에서 모두 바꾸기")}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /><path d="m14 15 3 3 4-4" /></svg>
                  </button>
                )}
                {file.project && <ProjectPathTooltip file={file} scopes={scopes} />}
              </div>
              {!isCollapsed &&
                file.matches.map((m, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onOpenResult(file.path, m, m.reveal || query, opts, file.project?.id)}
                    className="flex w-full items-baseline gap-2 py-0.5 pl-7 pr-2 text-left hover:bg-surface-hover"
                  >
                    <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">{m.line}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-secondary">
                      {m.heading && <span className="mr-1 text-accent">{m.heading}</span>}
                      {renderPreview(m)}
                      {typeof m.score === 'number' && <span className="ml-1 text-[10px] text-ink-faint">{m.score.toFixed(2)}</span>}
                    </span>
                  </button>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FileNamePathTooltip({ file }: { file: FileSearchResult }) {
  useUiLocale()
  const parts = file.path.split('/').filter(Boolean)
  const relative = file.scope.id.startsWith('subproject:') ? parts.slice(1) : parts
  return <div className="pointer-events-none absolute left-2 top-full z-40 hidden min-w-[15rem] max-w-[22rem] rounded border border-edge-bright bg-surface-deep p-3 text-xs shadow-xl group-hover:block"><div className="mb-2 flex items-center gap-2 font-medium text-ink"><ProjectIcon icon={file.scope.icon} size={16} /><span>{file.scope.label}</span></div><div className="space-y-1 text-ink-secondary">{relative.map((part, index) => <div key={`${part}:${index}`} className="flex gap-1" style={{ paddingLeft: `${index * 12}px` }}><span>ㄴ</span><span className={index === relative.length - 1 ? 'text-ink' : ''}>{part}</span></div>)}</div></div>
}

function searchResultKey(file: SearchFileResult, fallbackProject: string): string {
  return `${file.project?.id ?? fallbackProject}:${file.path}`
}

function ProjectPathTooltip({ file, scopes }: { file: SearchFileResult; scopes: SearchScopeOption[] }) {
  useUiLocale()
  const owner = file.project!
  const icon = owner.kind === 'docs' ? 'i:notes' : owner.kind === 'subproject' ? (scopes.find((scope) => scope.label === owner.label)?.icon ?? 'i:folder') : 'i:folder'
  const parts = file.path.split('/').filter(Boolean)
  const relative = owner.kind === 'subproject' ? parts.slice(1) : parts
  return <div className="pointer-events-none absolute left-2 top-full z-40 hidden min-w-[15rem] max-w-[22rem] rounded border border-edge-bright bg-surface-deep p-3 text-xs shadow-xl group-hover:block">
    <div className="mb-2 flex items-center gap-2 font-medium text-ink"><ProjectIcon icon={icon} size={16} /><span>{owner.label}</span></div>
    <div className="space-y-1 text-ink-secondary">
      {relative.map((part, index) => <div key={`${part}:${index}`} className="flex items-center gap-1" style={{ paddingLeft: `${index * 12}px` }}><span className="text-ink-faint">ㄴ</span><span className={index === relative.length - 1 ? 'text-ink' : ''}>{part}</span></div>)}
    </div>
  </div>
}

function fileName(p: string): string {
  return p.split('/').pop() ?? p
}
function dirName(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

/** 매치 줄 미리보기 — 앞쪽 공백을 접고, 매치 구간을 강조한다 */
function renderPreview(m: SearchMatch) {
  const trimmed = m.text.trimStart()
  if (typeof m.score === 'number') return trimmed
  const lead = m.text.length - trimmed.length
  const s = Math.max(0, m.matchStart - lead)
  const e = Math.max(s, m.matchEnd - lead)
  return (
    <>
      {trimmed.slice(0, s)}
      <mark className="rounded-sm bg-warning/40 text-ink">{trimmed.slice(s, e)}</mark>
      {trimmed.slice(e)}
    </>
  )
}
