import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DialogFrame } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { fetchDocumentGraph } from '../api/client'
import { DocumentGraphCanvas } from '../utils/document-graph-canvas'
import type { DocumentGraphData } from '../../shared/document-graph'

const buttonClass = 'flex h-8 shrink-0 items-center justify-center rounded px-2 text-sm text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent'

export function DocumentGraph({ onClose, onOpen, revision }: { onClose: () => void; onOpen: (path: string) => void; revision: number }) {
  useUiLocale()
  const [graph, setGraph] = useState<DocumentGraphData | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [showList, setShowList] = useState(false)
  const [selected, setSelected] = useState(-1)
  const [reload, setReload] = useState(0)
  const [workerError, setWorkerError] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const scene = useRef<DocumentGraphCanvas | null>(null)
  const openRef = useRef(onOpen)
  openRef.current = onOpen

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let request = 0
    const load = () => {
      const current = ++request
      void fetchDocumentGraph(controller.signal).then(value => { if (!controller.signal.aborted && current === request) { setGraph(value); setSelected(-1); setError('') } }).catch(error => { if (!controller.signal.aborted && current === request) setError(error instanceof Error ? error.message : String(error)) })
    }
    // Watcher bursts are coalesced; old nodes are removed immediately on permission changes.
    const permissions = () => { setGraph(null); setSelected(-1); load() }
    window.addEventListener('mew:permissions-changed', permissions)
    if (revision > 0) timer = setTimeout(load, 180)
    else load()
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('mew:permissions-changed', permissions) }
  }, [revision, reload])

  useEffect(() => {
    if (!graph || !canvas.current || !graph.nodes.length) return
    setWorkerError(false)
    let worker: Worker
    try { worker = new Worker(new URL('../utils/document-graph-worker.ts', import.meta.url), { type: 'module' }) }
    catch { setWorkerError(true); return }
    const renderer = new DocumentGraphCanvas(canvas.current, graph, worker, setSelected, index => openRef.current(graph.nodes[index].path))
    scene.current = renderer
    canvas.current.dataset.graphState = 'running'
    worker.onmessage = event => { renderer.update(event.data.positions, event.data.settled); if (canvas.current) canvas.current.dataset.graphState = event.data.settled ? 'settled' : 'running' }
    worker.onerror = () => { setWorkerError(true); worker.terminate() }
    const edges = new Uint32Array(graph.edges.flat())
    worker.postMessage({ type: 'init', count: graph.nodes.length, edges }, [edges.buffer])
    return () => { renderer.destroy(); worker.terminate(); scene.current = null }
  }, [graph])

  const results = useMemo(() => {
    if (!graph) return []
    const term = query.trim().toLocaleLowerCase()
    return graph.nodes.map((node, index) => ({ node, index })).filter(({ node }) => !term || `${node.title}\n${node.path}`.toLocaleLowerCase().includes(term))
  }, [graph, query])
  const [listLimit, setListLimit] = useState(60)
  useEffect(() => setListLimit(60), [query, graph])
  const selectedNode = graph?.nodes[selected]
  const openSelected = useCallback(() => { if (selectedNode) onOpen(selectedNode.path) }, [onOpen, selectedNode])

  return <DialogFrame labelledBy="document-graph-title" onClose={onClose} className="flex h-[calc(100dvh-2rem)] max-h-[900px] max-w-[1400px] flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-edge px-2 py-1">
      <h2 id="document-graph-title" className="mr-2 text-sm font-medium text-ink">{uiText('문서 그래프')}</h2>
      {graph && <span className="mr-auto text-xs tabular-nums text-ink-secondary">{uiText('{p0}개 문서 · {p1}개 링크', { p0: graph.nodes.length, p1: graph.edges.length })}</span>}
      <button type="button" className={buttonClass} onClick={() => setReload(value => value + 1)} aria-label={uiText('새로고침')}><svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M19 11a7 7 0 0 0-12-5l-3 3M5 13a7 7 0 0 0 12 5l3-3"/></svg></button>
      <button type="button" className={buttonClass} onClick={onClose} aria-label={uiText('닫기')}><svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
    </div>
    <div className="flex shrink-0 items-center gap-1 border-b border-edge px-2 py-1">
      <input type="search" aria-label={uiText('문서 검색')} placeholder={uiText('문서 검색')} value={query} onChange={event => setQuery(event.target.value)} className="h-8 min-w-0 flex-1 rounded bg-surface-deep px-2 text-sm text-ink outline-none focus-visible:ring-1 focus-visible:ring-accent" />
      <button type="button" className={buttonClass} aria-pressed={showList} onClick={() => setShowList(value => !value)}>{uiText('목록')}</button>
      <button type="button" className={buttonClass} onClick={() => scene.current?.fit()}>{uiText('전체 보기')}</button>
      <button type="button" className={buttonClass} aria-label={uiText('축소')} onClick={() => scene.current?.zoom(0.8)}>−</button>
      <button type="button" className={buttonClass} aria-label={uiText('확대')} onClick={() => scene.current?.zoom(1.25)}>+</button>
    </div>
    {error && <div role="alert" className="shrink-0 px-3 py-2 text-sm text-danger">{error}</div>}
    {workerError && <div role="alert" className="shrink-0 px-3 py-2 text-sm text-danger">{uiText('그래프를 표시하지 못했습니다. 새로고침하거나 목록에서 문서를 여세요.')}</div>}
    {graph && graph.skipped > 0 && <div role="status" className="shrink-0 px-3 py-1 text-xs text-ink-secondary">{uiText('{p0}개 문서는 크기나 읽기 오류로 제외되었습니다.', { p0: graph.skipped })}</div>}
    <div className="relative flex min-h-0 flex-1">
      {(showList || query || workerError) && <div className="absolute inset-y-0 left-0 z-10 w-[min(260px,75%)] overflow-y-auto border-r border-edge bg-surface p-1" aria-label={uiText('문서 목록')}>
        {results.slice(0, listLimit).map(({ node, index }) => <div key={node.path} className="flex items-center">
          <button type="button" title={node.path} onClick={() => { scene.current?.focus(index); setSelected(index) }} aria-pressed={selected === index} className={`min-w-0 flex-1 rounded px-2 py-1.5 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent ${selected === index ? 'bg-surface-raised text-ink' : 'text-ink-secondary hover:bg-surface-hover'}`}>
            <span className="block truncate">{node.title}</span><span className="block truncate text-xs text-ink-muted">{node.path}</span>
          </button>
          <button type="button" className={buttonClass} aria-label={uiText('{p0} 열기', { p0: node.title })} onClick={() => onOpen(node.path)}><svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10" /></svg></button>
        </div>)}
        {results.length === 0 && <p className="px-2 py-2 text-sm text-ink-muted">{uiText('검색 결과가 없습니다')}</p>}
        {results.length > listLimit && <button type="button" className={`${buttonClass} w-full`} onClick={() => setListLimit(value => value + 60)}>{uiText('더 보기')}</button>}
      </div>}
      <canvas ref={canvas} tabIndex={0} aria-label={uiText('문서 그래프')} className="h-full w-full touch-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent" />
      {!graph && !error && <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-muted">{uiText('그래프를 불러오는 중…')}</div>}
      {graph?.nodes.length === 0 && <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-muted">{uiText('표시할 문서가 없습니다')}</div>}
    </div>
    {selectedNode && <div className="flex shrink-0 items-center gap-2 border-t border-edge px-3 py-1.5">
      <div className="min-w-0 flex-1"><div className="truncate text-sm text-ink">{selectedNode.title}</div><div className="truncate text-xs text-ink-muted">{selectedNode.path}</div></div>
      <button type="button" className={buttonClass} onClick={openSelected}>{uiText('문서 열기')}</button>
    </div>}
  </DialogFrame>
}
