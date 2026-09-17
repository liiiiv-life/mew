import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookStack, PlugTypeA, Xmark, RefreshDouble, Plus, NavArrowRight } from 'iconoir-react'
import { useOverlayDismiss } from '@mew/ui'
import { fetchHarness, fetchHarnessDetail, mutateHarness } from '../api/agent-harness'
import type { HarnessDetail, HarnessInventory, HarnessItem, HarnessKind, HarnessLocation, HarnessMutation } from '../../shared/agent-harness'

const button = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded px-3 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40'
const input = 'min-h-9 min-w-0 rounded border border-edge-strong bg-surface px-2 text-xs text-ink focus:outline-2 focus:outline-accent'
function mcpDraft(agent?: string) {
  return JSON.stringify(agent === 'opencode' ? { type: 'local', command: [''] } : agent === 'prime' ? { type: 'http', url: '' } : { command: '', args: [] }, null, 2)
}

export function AgentHarnessButtons({ cwd }: { cwd: string }) {
  const [open, setOpen] = useState<HarnessKind | null>(null)
  return <>
    <button type="button" aria-label="Skills 관리" title="Skills 관리" data-tip="Skills 관리" onClick={() => setOpen('skills')} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"><BookStack width={14} height={14} aria-hidden /></button>
    <button type="button" aria-label="MCP 관리" title="MCP 관리" data-tip="MCP 관리" onClick={() => setOpen('mcp')} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"><PlugTypeA width={14} height={14} aria-hidden /></button>
    {open && <AgentHarnessModal key={cwd} cwd={cwd} initialKind={open} onClose={() => setOpen(null)} />}
  </>
}

export function AgentHarnessModal({ cwd, initialKind, onClose }: { cwd: string; initialKind: HarnessKind; onClose: () => void }) {
  const [kind, setKind] = useState(initialKind)
  const [inventory, setInventory] = useState<HarnessInventory | null>(null)
  const [scope, setScope] = useState('all'), [agent, setAgent] = useState('all'), [search, setSearch] = useState('')
  const [collapsedScopes, setCollapsedScopes] = useState<Set<string>>(() => new Set())
  const scopeListId = useId()
  const [selected, setSelected] = useState<HarnessItem | null>(null)
  const [detail, setDetail] = useState<HarnessDetail | null>(null)
  const [editing, setEditing] = useState(false), [creating, setCreating] = useState(false), [moving, setMoving] = useState(false)
  const [content, setContent] = useState(''), [name, setName] = useState(''), [target, setTarget] = useState('')
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [reload, setReload] = useState(0)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [confirmation, setConfirmation] = useState<{ text: string; label: string; action: () => void } | null>(null)
  const dialog = useRef<HTMLDivElement>(null), searchRef = useRef<HTMLInputElement>(null), confirmRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null), hadDetail = useRef(false)
  const dirty = creating || editing && content !== detail?.content
  const reset = () => { setSelected(null); setDetail(null); setEditing(false); setCreating(false); setMoving(false); setContent(''); setError(''); setTarget('') }
  const guarded = (action: () => void) => {
    if (busy) return
    if (dirty) setConfirmation({ text: '저장하지 않은 변경사항을 버릴까요?', label: '변경 버리기', action })
    else action()
  }
  const close = () => { if (confirmation) setConfirmation(null); else guarded(onClose) }
  useOverlayDismiss(close)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    searchRef.current?.focus()
    return () => { if (opener?.isConnected) opener.focus() }
  }, [])
  useEffect(() => {
    if (!confirmation) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    confirmRef.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [confirmation])
  useEffect(() => {
    if (!dirty) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setInventory(null); setError('')
    fetchHarness(cwd, kind, controller.signal).then(setInventory).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [cwd, kind, reload])
  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    setDetail(null); setError('')
    fetchHarnessDetail(cwd, kind, selected.id, controller.signal).then(value => { setDetail(value); setContent(value.content) }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [cwd, kind, selected])

  const locationOf = useCallback((item: HarnessItem) => inventory?.locations.find(location => location.id === item.location), [inventory])
  const filtered = inventory?.items.filter(item => {
    const location = locationOf(item)
    return (scope === 'all' || location?.scope === scope) && (agent === 'all' || location?.agent === agent)
      && `${item.name} ${item.description} ${item.path}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  }) ?? []
  const selectedLocation = selected && locationOf(selected)
  const destinations = inventory?.locations.filter(location => location.writable && (!moving || location.id !== selected?.location && (kind === 'skills' || location.agent === selectedLocation?.agent))) ?? []
  const availableLocations = inventory?.locations.filter(location => (scope === 'all' || location.scope === scope) && (agent === 'all' || location.agent === agent)) ?? []
  const scopeLabel = (id?: string) => inventory?.scopes.find(scope => scope.id === id)?.label ?? ''
  const targetOptions = (locations: HarnessLocation[]) => inventory?.scopes.map(scope => <optgroup key={scope.id} label={scope.global ? '전역' : `프로젝트 · ${scope.label}`}>
    {locations.filter(location => location.scope === scope.id).map(location => <option key={location.id} value={location.id}>{location.label}</option>)}
  </optgroup>)

  async function mutate(action: HarnessMutation['action']) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await mutateHarness({ cwd, kind, action, id: selected?.id, revision: detail?.revision, target, name, content })
      reset(); setReload(value => value + 1)
      setNotice(action === 'delete' ? '삭제했습니다.' : action === 'move' ? '이동했습니다. 적용 시점은 에이전트에 따라 다릅니다.' : '저장했습니다. 적용 시점은 에이전트에 따라 다릅니다.')
      window.dispatchEvent(new Event('mew:harness-changed'))
    } catch (error) { setError(error instanceof Error ? error.message : '변경하지 못했습니다') }
    finally { setBusy(false) }
  }
  function create() {
    reset(); setCreating(true)
    const location = availableLocations.find(location => location.writable)
    setTarget(location?.id ?? destinations[0]?.id ?? '')
    setName('')
    setContent(kind === 'skills' ? '---\nname: my-skill\ndescription: 스킬의 용도를 적어주세요\n---\n\n# 지침\n' : mcpDraft(location?.agent ?? destinations[0]?.agent))
  }
  const showingDetail = !!selected || creating
  useEffect(() => {
    if (showingDetail && (creating || window.matchMedia('(max-width: 767px)').matches)) headingRef.current?.focus()
    else if (!showingDetail && hadDetail.current) searchRef.current?.focus()
    hadDetail.current = showingDetail
  }, [showingDetail, selected?.id, creating])
  return createPortal(<div data-cmd-overlay className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-2 sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="에이전트 확장 관리" className="flex h-[90dvh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-surface text-ink shadow-xl" onKeyDown={event => {
      if (event.key !== 'Tab') return
      const focusRoot = confirmation ? dialog.current?.querySelector('[role="alertdialog"]') : dialog.current
      const nodes = Array.from(focusRoot?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') ?? []).filter(node => node.getClientRects().length && !node.closest('[inert]'))
      const first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <header inert={confirmation ? true : undefined} className="flex shrink-0 items-center gap-3 border-b border-edge px-3 py-2 sm:px-5">
        <h2 className="text-sm font-semibold">에이전트 확장</h2>
        <div className="flex gap-1" role="group" aria-label="확장 종류">
          {(['skills', 'mcp'] as const).map(value => <button key={value} type="button" aria-pressed={kind === value} onClick={() => guarded(() => { reset(); setKind(value); setNotice('') })} className={`${button} ${kind === value ? 'bg-surface-hover text-ink font-semibold' : ''}`}>{value === 'skills' ? 'Skills' : 'MCP'}</button>)}
        </div>
        <button type="button" className={`${button} ml-auto px-2`} aria-label="닫기" onClick={close} disabled={busy}><Xmark width={18} height={18} aria-hidden /></button>
      </header>
      {confirmation && <div role="alertdialog" aria-label="변경 확인" aria-describedby="harness-confirm" className="flex flex-wrap items-center gap-2 border-b border-edge bg-surface-raised px-4 py-3">
        <p id="harness-confirm" className="min-w-0 flex-1 text-sm">{confirmation.text}</p>
        <button type="button" className={button} onClick={() => setConfirmation(null)}>취소</button>
        <button ref={confirmRef} type="button" className={`${button} text-danger-strong`} onClick={() => { const action = confirmation.action; setConfirmation(null); action() }}>{confirmation.label}</button>
      </div>}
      {error && <div role="alert" className="shrink-0 border-b border-edge px-4 py-2 text-xs text-danger-strong">{error} <button type="button" className={button} disabled={busy} onClick={() => guarded(() => { reset(); setReload(value => value + 1) })}>다시 불러오기</button></div>}
      {notice && <p role="status" className="shrink-0 border-b border-edge px-4 py-2 text-xs text-ink-secondary">{notice}</p>}
      <div className="flex min-h-0 flex-1" inert={confirmation ? true : undefined}>
        <aside className={`${showingDetail ? 'hidden md:flex' : 'flex'} min-h-0 w-full flex-col border-r border-edge md:w-80 md:shrink-0`}>
          <div className="space-y-2 border-b border-edge p-3">
            <div className="flex gap-1">
              <input ref={searchRef} className={`${input} w-full`} aria-label="확장 검색" placeholder={kind === 'skills' ? '스킬 이름·설명 검색' : 'MCP 이름 검색'} value={search} onChange={event => setSearch(event.target.value)} />
              <button type="button" className={`${button} px-2`} aria-label="새로고침" disabled={loading || busy} onClick={() => guarded(() => { reset(); setReload(value => value + 1) })}><RefreshDouble width={16} height={16} aria-hidden /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select className={input} aria-label="스코프" value={scope} onChange={event => { const value = event.target.value; guarded(() => { reset(); setScope(value) }) }}><option value="all">모든 스코프</option>{inventory?.scopes.map(scope => <option key={scope.id} value={scope.id}>{scope.global ? '전역' : scope.path === cwd ? `현재 · ${scope.label}` : scope.label}</option>)}</select>
              <select className={input} aria-label="에이전트" value={agent} onChange={event => { const value = event.target.value; guarded(() => { reset(); setAgent(value) }) }}><option value="all">모든 에이전트</option>{inventory?.agents.filter(agent => kind === 'skills' || agent.id !== 'shared').map(agent => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select>
            </div>
          </div>
          <div className="flex items-center justify-between px-3 py-1 text-xs text-ink-secondary"><span>{loading ? '불러오는 중…' : `${filtered.length}개`}</span><button type="button" className={button} disabled={busy || loading || !availableLocations.some(location => location.writable)} onClick={() => guarded(create)}><Plus width={14} height={14} aria-hidden />추가</button></div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3" aria-label="확장 목록" aria-busy={loading}>
            {!loading && !filtered.length && <div className="px-4 py-8 text-sm text-ink-secondary">{search ? '검색 결과가 없습니다.' : !availableLocations.length ? '이 에이전트의 설정 위치는 아직 지원하지 않습니다.' : '이 범위에 등록된 항목이 없습니다.'}</div>}
            {inventory?.scopes.map((scope, scopeIndex) => {
              const items = filtered.filter(item => locationOf(item)?.scope === scope.id)
              if (!items.length) return null
              const scopeKey = `${kind}:${scope.id}`
              const expanded = !collapsedScopes.has(scopeKey)
              const title = scope.global ? '전역' : scope.path === cwd ? `현재 프로젝트 · ${scope.label}` : scope.label
              const listId = `${scopeListId}-${scopeIndex}`
              return <section key={scope.id} aria-label={scope.global ? '전역' : scope.label}>
                <h3><button type="button" aria-expanded={expanded} aria-controls={listId} aria-label={`${title} ${expanded ? '접기' : '펼치기'}`} onClick={() => setCollapsedScopes(previous => {
                  const next = new Set(previous)
                  if (next.has(scopeKey)) next.delete(scopeKey)
                  else next.add(scopeKey)
                  return next
                })} className="flex min-h-8 w-full items-center gap-1.5 bg-surface-raised px-3 py-1.5 text-left text-xs font-semibold text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
                  <NavArrowRight width={12} height={12} aria-hidden className={`shrink-0 ${expanded ? 'rotate-90' : ''}`} />
                  <span className="min-w-0 flex-1 break-words">{title}</span>
                  <span className="shrink-0 tabular-nums">{items.length}</span>
                </button></h3>
                <div id={listId} hidden={!expanded}>
                  {items.map(item => {
                    const location = locationOf(item)
                    const agentLabel = location?.agent === 'shared' ? 'Global' : inventory.agents.find(agent => agent.id === location?.agent)?.label ?? location?.label
                    return <button type="button" key={item.id} aria-pressed={selected?.id === item.id} title={`${item.name} · ${location?.label ?? ''} · ${item.path}${!item.writable ? ' · 읽기 전용' : ''}`} onClick={() => guarded(() => { reset(); setSelected(item) })} className={`flex h-8 w-full items-center gap-2 px-3 text-left text-sm hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent ${selected?.id === item.id ? 'bg-surface-hover' : ''}`}>
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      <span className="shrink-0 text-xs text-ink-secondary">{agentLabel}</span>
                    </button>
                  })}
                </div>
              </section>
            })}
          </div>
          {!!inventory?.warnings.length && <details className="max-h-36 shrink-0 overflow-auto border-t border-edge p-3 text-xs text-ink-secondary"><summary className="cursor-pointer">확인이 필요한 위치 {inventory.warnings.length}개</summary>{inventory.warnings.map(warning => <p key={warning} className="mt-2 break-all select-text">{warning}</p>)}</details>}
        </aside>
        <main className={`${showingDetail ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-1 flex-col`}>
          {!showingDetail ? <div className="m-auto max-w-sm space-y-2 p-6 text-center"><h3 className="text-base font-medium">{kind === 'skills' ? '스킬을 한곳에서' : 'MCP 연결을 한곳에서'}</h3><p className="text-sm leading-relaxed text-ink-secondary">목록에서 항목을 선택하면 내용과 적용 범위를 확인하고 관리할 수 있습니다.</p><p className="text-xs text-ink-secondary">전역 설정은 이 서버를 사용하는 에이전트에 적용됩니다.</p></div> : <>
            <div className="shrink-0 space-y-2 border-b border-edge p-4">
              <button type="button" className={`${button} -ml-3 md:hidden`} disabled={busy} onClick={() => guarded(reset)}>목록으로</button>
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 ref={headingRef} tabIndex={-1} className="break-words text-base font-semibold outline-none">{creating ? kind === 'skills' ? '스킬 추가' : 'MCP 추가' : selected?.name}</h3>{selectedLocation && <p className="mt-1 text-xs text-ink-secondary">{scopeLabel(selectedLocation.scope)} · {selectedLocation.label}</p>}</div>
                {!creating && detail && <div className="flex flex-wrap gap-1">
                  <button type="button" className={button} disabled={!detail.item.writable || busy || editing} onClick={() => { setEditing(true); setMoving(false) }}>수정</button>
                  <button type="button" className={button} disabled={!detail.item.writable || busy} onClick={() => guarded(() => { setEditing(false); setContent(detail.content); setMoving(!moving); setTarget(destinations[0]?.id ?? '') })}>이동</button>
                  <button type="button" className={`${button} text-danger-strong`} disabled={!detail.item.writable || busy} onClick={() => setConfirmation({ text: kind === 'skills' ? `${selected?.name} 스킬 폴더와 모든 부속 파일을 삭제할까요?` : `${selected?.name} MCP 설정을 삭제할까요?`, label: '삭제', action: () => { void mutate('delete') } })}>삭제</button>
                </div>}
              </div>
              {(detail?.item.description || selected?.description) && <p aria-label="확장 설명" className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words select-text text-xs leading-relaxed text-ink-secondary">{detail?.item.description || selected?.description}</p>}
              {selected && <p className="select-text break-all font-mono text-[11px] text-ink-secondary">{selected.path}</p>}
              {detail && !detail.item.writable && <p className="text-xs text-ink-secondary">읽기 전용 · {detail.item.reason}</p>}
              {kind === 'mcp' && (selectedLocation?.agent === 'openclaw' || destinations.find(location => location.id === target)?.agent === 'openclaw') && <p className="text-xs text-ink-secondary">저장하면 OpenClaw 설정의 주석을 제거하고 JSON 형식으로 정리합니다.</p>}
              {kind === 'mcp' && selectedLocation?.agent === 'codex' && (editing || moving) && <p className="text-xs text-ink-secondary">저장하면 MCP 구역의 주석과 서식을 정리합니다. 다른 설정값은 유지합니다.</p>}
              {(creating || moving) && <div className="space-y-2 pt-2">
                <label className="block space-y-1 text-xs text-ink-secondary"><span>{moving ? '이동할 위치' : '저장할 위치'}</span><select className={`${input} w-full`} value={target} onChange={event => {
                  const value = event.target.value
                  if (creating && kind === 'mcp' && content === mcpDraft(destinations.find(location => location.id === target)?.agent)) setContent(mcpDraft(destinations.find(location => location.id === value)?.agent))
                  setTarget(value)
                }} aria-label="대상 위치"><option value="">위치 선택</option>{targetOptions(destinations)}</select></label>
                {target && <p className="select-text break-all text-xs text-ink-secondary">{destinations.find(location => location.id === target)?.path}</p>}
                {creating && <label className="block space-y-1 text-xs text-ink-secondary"><span>이름</span><input className={`${input} w-full`} value={name} onChange={event => {
                  const value = event.target.value
                  if (kind === 'skills') setContent(content => content.replace(`\nname: ${name || 'my-skill'}\n`, `\nname: ${value || 'my-skill'}\n`))
                  setName(value)
                }} aria-label="이름" placeholder={kind === 'skills' ? 'my-skill' : 'my-server'} /></label>}
                {moving && <div className="flex flex-wrap items-center gap-2"><p className="min-w-0 flex-1 text-xs text-ink-secondary">{kind === 'skills' ? '부속 파일도 함께 이동합니다. 상대 경로 참조를 확인하세요.' : '동일 에이전트의 적용 범위가 바뀝니다.'}</p><button type="button" className={button} disabled={busy} onClick={() => setMoving(false)}>취소</button><button type="button" className={`${button} bg-accent text-ink-on-accent`} disabled={busy || !target} onClick={() => setConfirmation({ text: `${selected?.name}을(를) ${scopeLabel(destinations.find(location => location.id === target)?.scope)} · ${destinations.find(location => location.id === target)?.label}(으)로 이동할까요?`, label: '이동', action: () => { void mutate('move') } })}>이동 확인</button></div>}
              </div>}
            </div>
            {!creating && !detail ? <p role="status" className="p-5 text-sm text-ink-secondary">{error ? '내용을 불러오지 못했습니다.' : '내용을 불러오는 중…'}</p> : <>
              {(editing || creating) ? <textarea aria-label={kind === 'skills' ? '스킬 내용' : 'MCP 설정 JSON'} spellCheck={false} value={content} onChange={event => setContent(event.target.value)} disabled={busy} className="min-h-32 min-w-0 flex-1 resize-none bg-surface-deep p-4 font-mono text-xs leading-relaxed text-ink outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" /> : <pre tabIndex={0} aria-label="확장 내용" className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-surface-deep p-4 font-mono text-xs leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-accent">{detail?.content}</pre>}
              {!!detail?.files.length && !editing && <details className="max-h-32 shrink-0 overflow-auto border-t border-edge px-4 py-2 text-xs text-ink-secondary"><summary className="cursor-pointer">포함된 파일 {detail.files.length}개</summary>{detail.files.map(file => <p key={file} className="mt-1 select-text break-all font-mono">{file}</p>)}</details>}
              {(editing || creating) && <footer className="flex shrink-0 items-center gap-2 border-t border-edge p-3"><span className="min-w-0 flex-1 text-xs text-ink-secondary">{kind === 'mcp' ? '선택한 서버의 설정을 JSON으로 편집합니다.' : 'SKILL.md 원문'}</span><button type="button" className={button} disabled={busy} onClick={() => guarded(() => { if (creating) reset(); else { setEditing(false); setContent(detail?.content ?? '') } })}>취소</button><button type="button" className={`${button} bg-accent text-ink-on-accent hover:bg-accent/90`} disabled={busy || creating && (!target || !name.trim()) || !creating && !dirty} onClick={() => void mutate(creating ? 'create' : 'save')}>{busy ? '저장 중…' : '저장'}</button></footer>}
            </>}
          </>}
        </main>
      </div>
    </div>
  </div>, document.body)
}
