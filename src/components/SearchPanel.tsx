import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { replaceInProjectFile, searchProject, type SearchFileResult, type SearchMatch, type SearchOptions } from '../api/client'

// VSCode식 프로젝트 전체 검색 패널(Ctrl+Shift+F) — 사이드바에 뜨며 찾기·바꾸기·정규식을 지원한다.
// 파일별로 매치를 접을 수 있고, 매치를 클릭하면 해당 파일을 열어 그 위치를 강조한다.

export function SearchPanel({
  focusSignal,
  readOnly,
  onOpenResult,
  onReplaced,
}: {
  /** Ctrl+Shift+F가 눌릴 때마다 증가 — 입력창을 포커스한다 */
  focusSignal: number
  /** 게스트면 바꾸기 UI를 숨긴다 */
  readOnly: boolean
  onOpenResult: (path: string, match: SearchMatch, query: string, opts: SearchOptions) => void
  /** 치환이 끝난 뒤 (트리·열린 파일 새로고침용) */
  onReplaced: () => void
}) {
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [results, setResults] = useState<SearchFileResult[]>([])
  const [truncated, setTruncated] = useState(false)
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

  const opts: SearchOptions = { regex, caseSensitive }

  const run = useCallback(
    (q: string, o: SearchOptions) => {
      const id = ++reqIdRef.current
      if (!q) {
        setResults([])
        setTruncated(false)
        setError(null)
        setLoading(false)
        return
      }
      setLoading(true)
      searchProject(q, o)
        .then((res) => {
          if (id !== reqIdRef.current) return // 더 최신 요청이 있으면 버린다
          setResults(res.results)
          setTruncated(res.truncated)
          setError(null)
        })
        .catch((err) => {
          if (id !== reqIdRef.current) return
          setResults([])
          setError(err instanceof Error ? err.message : '검색 실패')
        })
        .finally(() => {
          if (id === reqIdRef.current) setLoading(false)
        })
    },
    [],
  )

  // 검색어·옵션 변경 시 디바운스 후 검색
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => run(query, opts), 250)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, regex, caseSensitive])

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusSignal])

  const totalMatches = results.reduce((n, r) => n + r.matches.length, 0)

  async function replaceAllInFile(file: SearchFileResult) {
    if (busy) return
    setBusy(true)
    try {
      await replaceInProjectFile(file.path, query, replace, opts)
      onReplaced()
      run(query, opts)
    } catch (err) {
      setError(err instanceof Error ? err.message : '바꾸기 실패')
    } finally {
      setBusy(false)
    }
  }

  async function replaceAll() {
    if (busy || !results.length) return
    if (!window.confirm(`${results.length}개 파일에서 ${totalMatches}개 매치를 "${replace}"(으)로 모두 바꾸고 커밋합니다. 계속할까요?`)) return
    setBusy(true)
    try {
      for (const file of results) {
        await replaceInProjectFile(file.path, query, replace, opts)
      }
      onReplaced()
      run(query, opts)
    } catch (err) {
      setError(err instanceof Error ? err.message : '바꾸기 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      <div className="flex items-start gap-1 border-b border-edge px-2 py-2">
        <button
          type="button"
          onClick={() => setShowReplace((v) => !v)}
          className="mt-1 rounded p-1 text-ink-muted hover:bg-surface-hover"
          title={showReplace ? '바꾸기 접기' : '바꾸기 펼치기'}
          aria-label="바꾸기 토글"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showReplace ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}>
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center rounded border border-edge-strong bg-surface-deep pl-1.5 focus-within:border-accent">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="검색"
              className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-faint"
              spellCheck={false}
            />
            <button type="button" onClick={() => setCaseSensitive((v) => !v)} className={`m-0.5 rounded px-1 py-0.5 text-xs font-mono ${caseSensitive ? 'bg-accent text-ink-on-accent' : 'text-ink-muted hover:bg-surface-hover'}`} title="대소문자 구분">Aa</button>
            <button type="button" onClick={() => setRegex((v) => !v)} className={`m-0.5 rounded px-1 py-0.5 text-xs font-mono ${regex ? 'bg-accent text-ink-on-accent' : 'text-ink-muted hover:bg-surface-hover'}`} title="정규식 사용">.*</button>
          </div>
          {showReplace && !readOnly && (
            <div className="flex items-center gap-1">
              <div className="flex min-w-0 flex-1 items-center rounded border border-edge-strong bg-surface-deep pl-1.5 focus-within:border-accent">
                <input
                  value={replace}
                  onChange={(e) => setReplace(e.target.value)}
                  placeholder="바꾸기"
                  className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-faint"
                  spellCheck={false}
                />
              </div>
              <button
                type="button"
                onClick={replaceAll}
                disabled={busy || !results.length}
                className="rounded px-1.5 py-1 text-xs text-ink-muted enabled:hover:bg-surface-hover disabled:opacity-40"
                title="모든 파일에서 모두 바꾸기 (커밋)"
              >
                모두
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="px-3 py-2 text-xs text-danger-strong">{error}</div>}
        {!error && query && !loading && results.length === 0 && (
          <div className="px-3 py-2 text-xs text-ink-muted">결과 없음</div>
        )}
        {!error && query && (
          <div className="px-3 py-1 text-xs text-ink-muted">
            {totalMatches}개 결과 · {results.length}개 파일{truncated ? ' (일부만 표시)' : ''}
          </div>
        )}
        {results.map((file) => {
          const isCollapsed = collapsed.has(file.path)
          return (
            <div key={file.path}>
              <div className="group flex items-center gap-1 px-2 py-0.5 hover:bg-surface-hover">
                <button type="button" onClick={() => toggleCollapsed(file.path)} className="rounded p-0.5 text-ink-muted" aria-label="접기/펼치기">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isCollapsed ? 'none' : 'rotate(90deg)', transition: 'transform 0.1s' }}>
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-secondary" title={file.path}>{fileName(file.path)}</span>
                <span className="text-xs text-ink-faint" title={file.path}>{dirName(file.path)}</span>
                <span className="ml-1 rounded-full bg-surface-raised px-1.5 text-[10px] text-ink-muted">{file.matches.length}</span>
                {showReplace && !readOnly && (
                  <button
                    type="button"
                    onClick={() => replaceAllInFile(file)}
                    disabled={busy}
                    className="hidden rounded p-0.5 text-ink-muted enabled:hover:bg-surface-hover disabled:opacity-40 group-hover:block"
                    title="이 파일에서 모두 바꾸기"
                    aria-label="이 파일에서 모두 바꾸기"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /><path d="m14 15 3 3 4-4" /></svg>
                  </button>
                )}
              </div>
              {!isCollapsed &&
                file.matches.map((m, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onOpenResult(file.path, m, query, opts)}
                    className="flex w-full items-baseline gap-2 py-0.5 pl-7 pr-2 text-left hover:bg-surface-hover"
                  >
                    <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">{m.line}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-secondary">
                      {renderPreview(m)}
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
