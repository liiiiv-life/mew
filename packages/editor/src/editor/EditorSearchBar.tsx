import { useEffect, useReducer, useRef, useState } from 'react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import type { SearchStorage } from './searchExtension'

/** 에디터 우상단에 뜨는 VSCode식 찾기·바꾸기 바 — 정규식/대소문자 토글과 매치 이동·치환을 제공한다.
 * 실제 하이라이트·매치 계산은 searchExtension이 담당하고, 이 컴포넌트는 그 storage를 읽어 조작만 한다. */
export function EditorSearchBar({
  editor,
  seed,
  seedNonce,
  onClose,
}: {
  editor: TiptapEditor
  seed?: string
  seedNonce: number
  onClose: () => void
}) {
  const storage = editor.storage.searchAndReplace as SearchStorage
  const [query, setQuery] = useState(storage.query)
  const [replace, setReplace] = useState(storage.replace)
  const [showReplace, setShowReplace] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(storage.caseSensitive)
  const [regex, setRegex] = useState(storage.regex)
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0)
  const findInputRef = useRef<HTMLInputElement>(null)

  // 확장 storage(매치 개수·현재 인덱스·정규식 에러)는 트랜잭션마다 바뀌므로 구독해 다시 그린다
  useEffect(() => {
    const onTx = () => forceUpdate()
    editor.on('transaction', onTx)
    return () => {
      editor.off('transaction', onTx)
    }
  }, [editor])

  // 열릴 때(그리고 새 seed로 다시 열릴 때)마다 검색어를 채우고 첫 매치로 이동한다
  useEffect(() => {
    const initial = seed ?? storage.query
    setQuery(initial)
    editor.commands.setSearchQuery(initial)
    if (editor.storage.searchAndReplace.results.length) editor.commands.gotoSearchResult(0)
    findInputRef.current?.focus()
    findInputRef.current?.select()
    // seedNonce가 바뀔 때만 재적용 — 타이핑 중 재실행을 막는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedNonce])

  function runQuery(next: string) {
    setQuery(next)
    editor.commands.setSearchQuery(next)
    if (editor.storage.searchAndReplace.results.length) editor.commands.gotoSearchResult(0)
  }

  function toggleCase() {
    const v = !caseSensitive
    setCaseSensitive(v)
    editor.commands.setSearchOptions({ caseSensitive: v })
    if (editor.storage.searchAndReplace.results.length) editor.commands.gotoSearchResult(0)
  }

  function toggleRegex() {
    const v = !regex
    setRegex(v)
    editor.commands.setSearchOptions({ regex: v })
    if (editor.storage.searchAndReplace.results.length) editor.commands.gotoSearchResult(0)
  }

  function close() {
    editor.commands.clearSearch()
    editor.commands.focus()
    onClose()
  }

  const total = storage.results.length
  const current = total ? storage.index + 1 : 0

  return (
    // 위치는 Editor가 sticky 앵커로 잡아 준다 — 여기서는 앵커 기준 우상단에만 붙인다
    <div
      className="editor-search-bar absolute right-2 top-2 flex items-start gap-1 rounded-md border border-edge-strong bg-surface-raised p-1.5 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          close()
        }
      }}
    >
      {/* 바꾸기 행 펼침 토글 */}
      <button
        type="button"
        onClick={() => setShowReplace((v) => !v)}
        className="mt-0.5 rounded p-1 text-ink-muted hover:bg-surface-hover"
        title={showReplace ? '바꾸기 접기' : '바꾸기 펼치기'}
        aria-label="바꾸기 토글"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showReplace ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>

      <div className="flex flex-col gap-1">
        {/* ── 찾기 행 ── */}
        <div className="flex items-center gap-1">
          <div className="flex items-center rounded border border-edge-strong bg-surface-deep pl-1.5 focus-within:border-accent">
            <input
              ref={findInputRef}
              value={query}
              onChange={(e) => runQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (e.shiftKey) editor.commands.findPrevResult()
                  else editor.commands.findNextResult()
                }
              }}
              placeholder="찾기"
              className="w-44 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-faint"
              spellCheck={false}
            />
            <span className="whitespace-nowrap px-1.5 text-xs text-ink-muted">
              {storage.error ? '오류' : total ? `${current}/${total}` : '결과 없음'}
            </span>
            <button type="button" onClick={toggleCase} className={`m-0.5 rounded px-1 py-0.5 text-xs font-mono ${caseSensitive ? 'bg-accent text-ink-on-accent' : 'text-ink-muted hover:bg-surface-hover'}`} title="대소문자 구분">Aa</button>
            <button type="button" onClick={toggleRegex} className={`m-0.5 rounded px-1 py-0.5 text-xs font-mono ${regex ? 'bg-accent text-ink-on-accent' : 'text-ink-muted hover:bg-surface-hover'}`} title="정규식 사용">.*</button>
          </div>
          <button type="button" onClick={() => editor.commands.findPrevResult()} disabled={!total} className="rounded p-1 text-ink-muted enabled:hover:bg-surface-hover disabled:opacity-40" title="이전 매치 (Shift+Enter)" aria-label="이전 매치">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
          </button>
          <button type="button" onClick={() => editor.commands.findNextResult()} disabled={!total} className="rounded p-1 text-ink-muted enabled:hover:bg-surface-hover disabled:opacity-40" title="다음 매치 (Enter)" aria-label="다음 매치">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <button type="button" onClick={close} className="rounded p-1 text-ink-muted hover:bg-surface-hover" title="닫기 (Esc)" aria-label="검색 닫기">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* ── 바꾸기 행 ── */}
        {showReplace && (
          <div className="flex items-center gap-1">
            <div className="flex items-center rounded border border-edge-strong bg-surface-deep pl-1.5 focus-within:border-accent">
              <input
                value={replace}
                onChange={(e) => {
                  setReplace(e.target.value)
                  editor.commands.setReplaceTerm(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    editor.commands.replaceCurrentResult()
                  }
                }}
                placeholder="바꾸기"
                className="w-44 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-faint"
                spellCheck={false}
              />
            </div>
            <button type="button" onClick={() => editor.commands.replaceCurrentResult()} disabled={!total} className="rounded p-1 text-ink-muted enabled:hover:bg-surface-hover disabled:opacity-40" title="현재 매치 바꾸기 (Enter)" aria-label="바꾸기">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /><path d="m14 15 3 3 4-4" /></svg>
            </button>
            <button type="button" onClick={() => editor.commands.replaceAllResults()} disabled={!total} className="rounded px-1.5 py-1 text-xs text-ink-muted enabled:hover:bg-surface-hover disabled:opacity-40" title="모두 바꾸기" aria-label="모두 바꾸기">
              모두
            </button>
          </div>
        )}
        {storage.error && <div className="px-1 text-xs text-danger-strong">정규식 오류: {storage.error}</div>}
      </div>
    </div>
  )
}
