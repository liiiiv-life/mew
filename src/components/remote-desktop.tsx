import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from '@mew/ui'
import { desktopCursor } from '../utils/desktop-cursor.ts'
import { connectDesktop, type DesktopScreen, type DesktopState } from '../utils/desktop-connection.ts'
import { clampView, type DesktopInput } from '../utils/desktop-input.ts'
import { KEY_CODES } from '../../native/remote-desktop/keys.mjs'
import { DesktopIcon, DesktopStick } from './desktop-stick.tsx'
import { useDesktopInstall } from './desktop-install.tsx'
import './remote-desktop.css'

export function RemoteDesktop({ onClose }: { onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null), strip = useRef<HTMLDivElement>(null)
  const cursorImage = useRef<HTMLImageElement>(null), cursor = useRef<ReturnType<typeof desktopCursor> | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null), surface = useRef<'direct' | 'server'>('direct')
  const [transport, setTransport] = useState<'direct' | 'server'>('direct')
  const [cursorMode, setCursorMode] = useState<'local' | 'video' | null>(null)
  const session = useRef<ReturnType<typeof connectDesktop> | null>(null)
  const [state, setState] = useState<DesktopState>('preparing'), [message, setMessage] = useState(''), [stats, setStats] = useState('')
  const [screens, setScreens] = useState<DesktopScreen[]>([]), [selected, setSelected] = useState(''), [attempt, setAttempt] = useState(0)
  const preferred = useRef(''), [input, setInput] = useState<DesktopInput | null>(null), [relative, setRelative] = useState(false)
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 }), [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false), [text, setText] = useState(''), [helpOpen, setHelpOpen] = useState(false)
  const handle = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const connected = state === 'connected'
  useOverlayDismiss(onClose)
  const [installable, setInstallable] = useState(false)
  const install = useDesktopInstall(installable, () => setAttempt(value => value + 1))
  useEffect(() => {
    const element = root.current
    if (!element || !install.open) return
    element.inert = true
    return () => { element.inert = false; element.focus() }
  }, [install.open])

  const onView = useCallback((x: number, y: number, zoom: number) => {
    const rect = stage.current?.getBoundingClientRect()
    if (!rect) return
    const width = (surface.current === 'server' ? canvas.current?.width : video.current?.videoWidth) || rect.width
    const height = (surface.current === 'server' ? canvas.current?.height : video.current?.videoHeight) || rect.height
    const fit = Math.min(rect.width / width, rect.height / height)
    setView(previous => clampView({ x: previous.x - x, y: previous.y - y, scale: previous.scale * Math.exp(zoom) }, rect.width, rect.height, { width: width * fit, height: height * fit }))
  }, [])
  const clampStrip = useCallback((x: number, y: number) => {
    const area = root.current?.getBoundingClientRect(), bar = strip.current?.getBoundingClientRect(), top = stage.current?.getBoundingClientRect().top ?? 60
    return { x: Math.max(8, Math.min((area?.width ?? innerWidth) - (bar?.width ?? 240) - 8, x)), y: Math.max(top + 8, Math.min((area?.height ?? innerHeight) - (bar?.height ?? 128) - 16, y)) }
  }, [])
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    root.current?.focus()
    const siblings = [...document.body.children].filter(child => child !== root.current && child instanceof HTMLElement) as HTMLElement[]
    const inert = siblings.map(element => element.inert)
    siblings.forEach(element => { element.inert = true })
    return () => { siblings.forEach((element, i) => { element.inert = inert[i] }); previousFocus?.focus() }
  }, [])
  useEffect(() => {
    setStats(''); setRelative(false); setInstallable(false); setCursorMode(null); setView({ x: 0, y: 0, scale: 1 })
    setTransport('direct'); surface.current = 'direct'
    const element = video.current
    const local = desktopCursor(stage.current!, cursorImage.current!, () => surface.current === 'server' ? canvas.current : video.current)
    cursor.current = local
    const connection = connectDesktop({
      cursor: value => local.shape(value), localCursor: value => { local.enable(value); setCursorMode(value ? 'local' : 'video') }, pointer: (x, y, joystick) => local.point(x, y, joystick),
      state: (next, detail) => { setState(next); setMessage(detail) },
      screens: (list, chosen) => { setScreens(list); setSelected(chosen) },
      stream: stream => { if (video.current) { video.current.srcObject = stream; void video.current.play().catch(() => {}) } },
      frame: frame => {
        const target = canvas.current
        if (!target) return
        const resized = target.width !== frame.displayWidth || target.height !== frame.displayHeight
        if (target.width !== frame.displayWidth) target.width = frame.displayWidth
        if (target.height !== frame.displayHeight) target.height = frame.displayHeight
        const context = target.getContext('2d', { alpha: false })
        if (!context) throw new Error('원격 화면을 표시할 수 없습니다.')
        context.drawImage(frame, 0, 0)
        if (resized) local.refresh()
      },
      transport: mode => { surface.current = mode; setTransport(mode); setStats(''); if (mode === 'server' && video.current) video.current.srcObject = null },
      relative: setRelative, stats: setStats, installable: setInstallable,
    }, preferred.current)
    session.current = connection; setInput(connection.input)
    const hide = () => {
      if (document.hidden) { connection.close(); setState('paused'); setMessage('앱이 백그라운드로 이동해 연결을 종료했습니다.') }
    }
    const release = () => { try { connection.input.release() } catch { connection.fail('입력 연결이 지연됐습니다. 다시 연결해 주세요.') } }
    window.addEventListener('blur', release); document.addEventListener('visibilitychange', hide)
    return () => { local.close(); cursor.current = null; connection.close(); window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', hide); if (element) element.srcObject = null }
  }, [attempt])
  useEffect(() => {
    const resize = () => { setPosition(previous => previous ? clampStrip(previous.x, previous.y) : null); onView(0, 0, 0) }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [clampStrip, onView])

  useEffect(() => { cursor.current?.refresh() }, [view, transport])

  const close = () => { session.current?.close(); onClose() }
  const sendKey = (event: KeyboardEvent, down: boolean) => {
    event.stopPropagation()
    if (event.key === 'Escape') { if (down) close(); return }
    if (event.key === 'F6') { event.preventDefault(); if (down) root.current?.querySelector<HTMLButtonElement>('.desktop-tools button')?.focus(); return }
    // Only the actual viewport takes remote keyboard input; the toolbar remains accessible.
    if (event.target !== stage.current && event.target !== root.current) return
    if (connected && KEY_CODES[event.code]) { event.preventDefault(); if (!event.repeat) input?.key(event.code, down) }
  }
  const directPoint = (clientX: number, clientY: number, clamp = false) => {
    const element = surface.current === 'server' ? canvas.current : video.current
    const rect = element?.getBoundingClientRect()
    const nativeWidth = surface.current === 'server' ? canvas.current?.width : video.current?.videoWidth
    const nativeHeight = surface.current === 'server' ? canvas.current?.height : video.current?.videoHeight
    if (!rect || relative || !nativeWidth || !nativeHeight) return false
    const ratio = Math.min(rect.width / nativeWidth, rect.height / nativeHeight)
    const width = nativeWidth * ratio, height = nativeHeight * ratio
    const x = (clientX - rect.x - (rect.width - width) / 2) / width, y = (clientY - rect.y - (rect.height - height) / 2) / height
    if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return false
    input?.point(x, y); return true
  }
  return <>{createPortal(<div ref={root} className="remote-desktop" role="dialog" aria-modal="true" aria-labelledby="desktop-title" tabIndex={-1}
    onKeyDown={event => {
      if (event.key === 'Tab' && (event.target !== root.current && event.target !== stage.current || !connected)) {
        const items = root.current!.querySelectorAll<HTMLElement>('button:not(:disabled),select,input,textarea,[tabindex="0"]')
        const first = items[0], last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        event.stopPropagation(); return
      }
      sendKey(event, true)
    }} onKeyUp={event => sendKey(event, false)}>
    <header className="desktop-toolbar">
      <div className="desktop-title"><DesktopIcon kind="screen" /><strong id="desktop-title">원격 데스크톱</strong><span className="desktop-status" data-connected={connected}>{connected ? stats || '연결됨' : state === 'error' ? '연결 실패' : state === 'paused' ? '연결 종료' : '연결 중'}</span></div>
      <div className="desktop-tools">
        {screens.length > 1 && <select aria-label="공유 화면" value={selected} onChange={event => { preferred.current = event.target.value; setAttempt(value => value + 1) }}>{screens.map(screen => <option key={screen.id} value={screen.id}>{screen.label}</option>)}</select>}
        <button onClick={() => setView({ x: 0, y: 0, scale: 1 })} title="화면에 맞추기">맞춤 <span className="desktop-scale">{Math.round(view.scale * 100)}%</span></button>
        <button disabled={!connected} onClick={() => { input?.release(); setPasteOpen(value => !value); setHelpOpen(false) }} aria-expanded={pasteOpen}>입력</button>
        <button onClick={() => { setHelpOpen(value => !value); setPasteOpen(false) }} aria-expanded={helpOpen}>도움말</button>
        <button className="desktop-close" aria-label="원격 데스크톱 닫기" onClick={close}><DesktopIcon kind="close" /></button>
      </div>
    </header>
    <div ref={stage} className="desktop-stage" tabIndex={0} aria-label="원격 화면. 키보드 입력을 전달하려면 선택하세요."
      onBlur={() => input?.release()} onContextMenu={event => event.preventDefault()}
      onPointerDown={event => {
        if (!connected) return
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
        if (event.pointerType === 'touch') touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        else if (directPoint(event.clientX, event.clientY)) input?.button(event.button === 2 ? 4 : event.button === 1 ? 2 : 1, true)
      }}
      onPointerMove={event => {
        if (!connected) return
        const previous = touches.current.get(event.pointerId)
        if (previous) {
          const other = [...touches.current.entries()].find(([id]) => id !== event.pointerId)?.[1]
          if (other) {
            const before = Math.hypot(previous.x - other.x, previous.y - other.y), after = Math.hypot(event.clientX - other.x, event.clientY - other.y)
            if (before > 8 && after > 8) onView(0, 0, Math.log(after / before))
          } else onView(previous.x - event.clientX, previous.y - event.clientY, 0)
          touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        } else if (event.pointerType !== 'touch') { cursor.current?.mouse(); directPoint(event.clientX, event.clientY, event.buttons !== 0) }
      }}
      onPointerUp={event => { touches.current.delete(event.pointerId); if (event.pointerType !== 'touch' && connected) { directPoint(event.clientX, event.clientY, true); input?.button(event.button === 2 ? 4 : event.button === 1 ? 2 : 1, false) } }}
      onPointerCancel={() => { touches.current.clear(); input?.release() }}
      onLostPointerCapture={() => { touches.current.clear(); input?.release() }}
      onWheel={event => { if (connected && directPoint(event.clientX, event.clientY)) { event.preventDefault(); input?.wheel(event.deltaX * (event.deltaMode === 1 ? 40 : 1), event.deltaY * (event.deltaMode === 1 ? 40 : 1)) } }}>
      <video ref={video} autoPlay playsInline muted onLoadedMetadata={() => cursor.current?.refresh()} className="desktop-video" style={{ display: transport === 'direct' ? 'block' : 'none', transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
      <canvas ref={canvas} className="desktop-video" aria-hidden="true" style={{ display: transport === 'server' ? 'block' : 'none', transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
      <img ref={cursorImage} className="desktop-cursor" alt="" aria-hidden="true" hidden />
      {!connected && <div className="desktop-connection" role={state === 'error' ? 'alert' : 'status'}>
        <h2>{state === 'error' ? '화면을 연결하지 못했어요' : state === 'paused' ? '연결이 종료됐어요' : '서버 화면 연결 중'}</h2><p>{message}</p>
        {(installable || state === 'error' || state === 'paused') && <div className="desktop-connection-actions">
          {installable && install.actions}
          {(state === 'error' || state === 'paused') && <button onClick={() => setAttempt(value => value + 1)}>다시 연결</button>}
        </div>}
        {installable && install.error && <p className="desktop-install-error">{install.error}</p>}
      </div>}
    </div>
    {helpOpen && <aside className="desktop-help"><strong>작은 움직임으로 빠르게 조작</strong>{connected && cursorMode && <p data-cursor-mode={cursorMode}>커서 표시: {cursorMode === 'local' ? '이 기기에서 즉시 표시' : '영상에 포함됨. 현재 화면에서는 커서 분리를 사용할 수 없습니다.'}</p>}<p>마우스 모양 아래쪽의 커서 이동 영역을 밀면 커서만 움직입니다. 위쪽 좌클릭·우클릭은 탭하면 클릭하고, 밀면 바로 버튼을 누른 채 드래그합니다. 휠은 밀어서 세로 스크롤하고, 잠깐 꾹 누른 뒤 밀면 중간 버튼으로 드래그합니다.</p><p>화면 이동·확대는 내 화면에만 적용됩니다. 화면을 손가락으로 밀거나 두 손가락으로 확대할 수도 있습니다. 마지막 핸들로 조이스틱 전체를 옮기세요.</p>{relative && <p>이 서버는 조이스틱으로 커서를 이동합니다.</p>}<p>키보드: 화면 선택 후 입력 · F6: 도구로 이동 · Esc: 닫기</p></aside>}
    {pasteOpen && <form className="desktop-paste" onSubmit={event => { event.preventDefault(); input?.paste(text); setText(''); setPasteOpen(false); stage.current?.focus() }}><label htmlFor="desktop-paste">원격 컴퓨터에 붙여넣기</label><textarea id="desktop-paste" value={text} maxLength={4096} onChange={event => setText(event.target.value)} placeholder="전송할 텍스트" /><div><button type="button" onClick={() => { input?.key('Escape', true); input?.key('Escape', false) }}>원격 Esc</button><button type="submit" disabled={!connected || !text}>붙여넣기</button></div></form>}
    <div ref={strip} className="desktop-control-strip" role="group" aria-label="원격 데스크톱 조이스틱" style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}>
      <div className="desktop-mouse">
        {(['left', 'wheel', 'right', 'cursor'] as const).map(kind => <DesktopStick key={kind} kind={kind} input={input} disabled={!connected} onView={onView} />)}
      </div>
      <div className="desktop-view-controls">
        {(['pan', 'zoom'] as const).map(kind => <DesktopStick key={kind} kind={kind} input={input} disabled={!connected} onView={onView} />)}
      </div>
      <button className="desktop-handle" aria-label="조이스틱 위치 이동" title="드래그해서 조이스틱 전체 이동 · 방향키로도 이동" onContextMenu={event => event.preventDefault()}
        onPointerDown={event => { if (handle.current) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); const rect = strip.current!.getBoundingClientRect(); handle.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top } }}
        onPointerMove={event => { const start = handle.current; if (start?.id === event.pointerId) setPosition(clampStrip(start.left + event.clientX - start.x, start.top + event.clientY - start.y)) }}
        onPointerUp={() => { handle.current = null }} onPointerCancel={() => { handle.current = null }} onLostPointerCapture={() => { handle.current = null }}
        onKeyDown={event => { if (!event.key.startsWith('Arrow')) return; event.preventDefault(); event.stopPropagation(); const rect = strip.current!.getBoundingClientRect(); setPosition(clampStrip(rect.left + (event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0), rect.top + (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0))) }}><DesktopIcon kind="handle" /></button>
    </div>
  </div>, document.body)}{install.popup}</>
}
