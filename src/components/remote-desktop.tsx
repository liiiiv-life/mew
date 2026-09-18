import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from '@mew/ui'
import { desktopCursor } from '../utils/desktop-cursor.ts'
import { connectDesktop, type DesktopScreen, type DesktopState } from '../utils/desktop-connection.ts'
import { clampView, type DesktopInput } from '../utils/desktop-input.ts'
import { KEY_CODES } from '../../native/remote-desktop/keys.mjs'
import { DesktopFloating } from './desktop-floating.tsx'
import { desktopGeometry, readSensitivity, sensitivity as clampSensitivity, SENSITIVITY_KEY, type Rotation } from '../utils/desktop-view.ts'
import { DesktopIcon, DesktopStick } from './desktop-stick.tsx'
import { useDesktopInstall } from './desktop-install.tsx'
import './remote-desktop.css'

export function RemoteDesktop({ onClose }: { onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null)
  const cursorImage = useRef<HTMLImageElement>(null), cursor = useRef<ReturnType<typeof desktopCursor> | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null), surface = useRef<'direct' | 'server'>('direct')
  const [transport, setTransport] = useState<'direct' | 'server'>('direct')
  const [cursorMode, setCursorMode] = useState<'local' | 'video' | null>(null)
  const session = useRef<ReturnType<typeof connectDesktop> | null>(null)
  const [state, setState] = useState<DesktopState>('preparing'), [message, setMessage] = useState(''), [stats, setStats] = useState('')
  const [screens, setScreens] = useState<DesktopScreen[]>([]), [selected, setSelected] = useState(''), [attempt, setAttempt] = useState(0)
  const preferred = useRef(''), [input, setInput] = useState<DesktopInput | null>(null), [relative, setRelative] = useState(false)
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const [rotation, setRotation] = useState<Rotation>(0), [sensitivity, setSensitivity] = useState(readSensitivity)
  const [settingsOpen, setSettingsOpen] = useState(false), [fullscreen, setFullscreen] = useState(!!document.fullscreenElement), [fullscreenError, setFullscreenError] = useState('')
  const ownsFullscreen = useRef(false), [layout, setLayout] = useState(0), [modifier, setModifier] = useState('ControlLeft')
  const [viewport, setViewport] = useState({ width: 1, height: 1 }), [nativeSize, setNativeSize] = useState({ width: 1280, height: 720 })
  const geometry = desktopGeometry(viewport.width, viewport.height, nativeSize.width, nativeSize.height, rotation, view)
  const projection = useRef(geometry); projection.current = geometry
  const settingsButton = useRef<HTMLButtonElement>(null), settingsPanel = useRef<HTMLElement>(null)
  const [pasteOpen, setPasteOpen] = useState(false), [text, setText] = useState(''), [helpOpen, setHelpOpen] = useState(false)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const connected = state === 'connected'
  const close = () => { session.current?.close(); onClose() }
  const dismissInner = () => {
    if (settingsOpen) { setSettingsOpen(false); settingsButton.current?.focus() }
    else if (pasteOpen || helpOpen) { setPasteOpen(false); setHelpOpen(false); stage.current?.focus() }
    else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else return false
    return true
  }
  useOverlayDismiss(() => { if (!dismissInner()) close() }, { closeOnBack: () => !dismissInner() })
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
    setView(previous => clampView({ x: previous.x - x, y: previous.y - y, scale: previous.scale * Math.exp(zoom) }, rect.width, rect.height, projection.current.content))
  }, [])
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const rect = stage.current!.getBoundingClientRect()
      setViewport({ width: rect.width, height: rect.height })
    })
    observer.observe(stage.current!)
    const changed = () => { setFullscreen(!!document.fullscreenElement); if (!document.fullscreenElement) ownsFullscreen.current = false }
    document.addEventListener('fullscreenchange', changed)
    return () => { observer.disconnect(); document.removeEventListener('fullscreenchange', changed); if (ownsFullscreen.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {}) }
  }, [])
  useEffect(() => { onView(0, 0, 0) }, [viewport, nativeSize, rotation, onView])
  useEffect(() => { if (settingsOpen) settingsPanel.current?.querySelector<HTMLInputElement>('input')?.focus() }, [settingsOpen])
  const toggleFullscreen = async () => {
    setFullscreenError('')
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (document.documentElement.requestFullscreen) { ownsFullscreen.current = true; await document.documentElement.requestFullscreen() }
      else setFullscreenError('이 브라우저는 전체화면을 지원하지 않습니다. 홈 화면에 추가한 앱으로 열어 주세요.')
    } catch { ownsFullscreen.current = false; setFullscreenError('전체화면으로 전환하지 못했습니다. 브라우저 권한을 확인하고 다시 눌러 주세요.') }
  }
  const rotate = () => { input?.release(); setRotation(value => ((value + 90) % 360) as Rotation); setView({ x: 0, y: 0, scale: 1 }) }
  const updateSensitivity = (value: number) => {
    const next = clampSensitivity(value); setSensitivity(next)
    try { localStorage.setItem(SENSITIVITY_KEY, JSON.stringify(next)) } catch { /* Session setting still works without storage. */ }
  }
  const hotkey = (keys: string[]) => {
    if (!connected || !input) return
    input.release()
    try { keys.forEach(key => input.key(key, true)); [...keys].reverse().forEach(key => input.key(key, false)) }
    finally { input.release() }
  }
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
    const local = desktopCursor(stage.current!, cursorImage.current!, () => surface.current === 'server' ? canvas.current : video.current, (x, y) => projection.current.project(x, y))
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
        if (resized) { setNativeSize({ width: frame.displayWidth, height: frame.displayHeight }); local.refresh() }
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
  useEffect(() => { cursor.current?.refresh() }, [view, transport, rotation, viewport, nativeSize])

  const sendKey = (event: KeyboardEvent, down: boolean) => {
    event.stopPropagation()
    if (event.key === 'Escape') { if (down) close(); return }
    if (event.key === 'F6') { event.preventDefault(); if (down) root.current?.querySelector<HTMLButtonElement>('.desktop-tools button')?.focus(); return }
    // Only the actual viewport takes remote keyboard input; the toolbar remains accessible.
    if (event.target !== stage.current && event.target !== root.current) return
    if (connected && KEY_CODES[event.code]) { event.preventDefault(); if (!event.repeat) input?.key(event.code, down) }
  }
  const directPoint = (clientX: number, clientY: number, clamp = false) => {
    const rect = stage.current?.getBoundingClientRect()
    if (!rect || relative) return false
    const { x, y } = projection.current.unproject(clientX - rect.left, clientY - rect.top)
    if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return false
    input?.point(x, y); return true
  }
  const syncVideoSize = () => {
    const width = video.current?.videoWidth, height = video.current?.videoHeight
    if (!width || !height) return
    setNativeSize(previous => previous.width === width && previous.height === height ? previous : { width, height })
    cursor.current?.refresh()
  }
  const mediaStyle = { width: geometry.width, height: geometry.height, transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) rotate(${rotation}deg) scale(${view.scale})` }
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
        <button onClick={() => setView({ x: 0, y: 0, scale: 1 })} title="화면에 맞추기">맞춤 <span className="desktop-scale">{Math.round(view.scale * 100)}%</span></button>
        <button disabled={!connected} onClick={() => { input?.release(); setPasteOpen(value => !value); setHelpOpen(false); setSettingsOpen(false) }} aria-expanded={pasteOpen}>입력</button>
        <button onClick={() => { setHelpOpen(value => !value); setPasteOpen(false); setSettingsOpen(false) }} aria-expanded={helpOpen}>도움말</button>
        <button className="desktop-tool-icon" onClick={rotate} aria-label="화면 90도 회전" title={`화면 90도 회전 · 현재 ${rotation}°`}><DesktopIcon kind="rotate" /></button>
        <button className="desktop-tool-icon" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? '전체화면 해제' : '전체화면'} aria-pressed={fullscreen} title={fullscreen ? '전체화면 해제' : '전체화면'}><DesktopIcon kind="fullscreen" /></button>
        <button ref={settingsButton} className="desktop-tool-icon" aria-label="원격 데스크톱 설정" title="원격 데스크톱 설정" aria-expanded={settingsOpen} aria-controls="desktop-settings" onClick={() => { input?.release(); setSettingsOpen(value => !value); setHelpOpen(false); setPasteOpen(false) }}><DesktopIcon kind="settings" /></button>
        <button className="desktop-close" aria-label="원격 데스크톱 닫기" onClick={close}><DesktopIcon kind="close" /></button>
      </div>
    </header>
    {fullscreenError && <div className="desktop-notice" role="status">{fullscreenError}<button onClick={() => setFullscreenError('')} aria-label="전체화면 안내 닫기"><DesktopIcon kind="close" /></button></div>}
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
      <video ref={video} autoPlay playsInline muted onLoadedMetadata={syncVideoSize} onResize={syncVideoSize} className="desktop-video" style={{ ...mediaStyle, display: transport === 'direct' ? 'block' : 'none' }} />
      <canvas ref={canvas} className="desktop-video" aria-hidden="true" style={{ ...mediaStyle, display: transport === 'server' ? 'block' : 'none' }} />
      <img ref={cursorImage} className="desktop-cursor" alt="" aria-hidden="true" hidden />
      {!connected && <div className="desktop-connection" role={state === 'error' ? 'alert' : 'status'}>
        <h2>{state === 'error' ? '화면을 연결하지 못했어요' : state === 'paused' ? '연결이 종료됐어요' : '서버 화면 연결 중'}</h2><p>{message}</p>
        {(installable || state === 'error' || state === 'paused') && <div className="desktop-connection-actions">
          {installable && install.actions}
          {(state === 'error' || state === 'paused') && <button onClick={() => setAttempt(value => value + 1)}>다시 연결</button>}
        </div>}
        {installable && install.error && <p className="select-text desktop-install-error">{install.error}</p>}
      </div>}
    </div>
    {settingsOpen && <aside ref={settingsPanel} id="desktop-settings" className="desktop-settings" aria-label="원격 데스크톱 설정">
      <div className="desktop-settings-heading"><strong>원격 데스크톱 설정</strong><button aria-label="설정 닫기" onClick={() => { setSettingsOpen(false); settingsButton.current?.focus() }}><DesktopIcon kind="close" /></button></div>
      <label className="desktop-setting-label" htmlFor="desktop-sensitivity">마우스 커서 감도 <output htmlFor="desktop-sensitivity">{sensitivity.toFixed(1)}배</output></label>
      <input id="desktop-sensitivity" type="range" min="0.5" max="6" step="0.1" value={sensitivity} onChange={event => updateSensitivity(Number(event.target.value))} aria-describedby="desktop-sensitivity-help" />
      <p id="desktop-sensitivity-help">커서 이동·버튼 드래그에 적용됩니다. 1배는 이전 속도, 기본은 3배입니다. 화면 직접 클릭과 휠 속도는 유지됩니다.</p>
      <label className="desktop-setting-label" htmlFor="desktop-screen">공유 화면</label>
      <select id="desktop-screen" disabled={!screens.length} value={selected} onChange={event => { preferred.current = event.target.value; setAttempt(value => value + 1) }}>{screens.map(screen => <option key={screen.id} value={screen.id}>{screen.label}</option>)}</select>
      <label className="desktop-setting-label" htmlFor="desktop-modifier">핫키 보조키</label>
      <select id="desktop-modifier" value={modifier} onChange={event => setModifier(event.target.value)}><option value="ControlLeft">Ctrl · Windows / Linux</option><option value="MetaLeft">Cmd · Mac</option></select>
      <div className="desktop-settings-actions"><button onClick={() => { input?.release(); setLayout(value => value + 1) }}>버튼 위치 초기화</button><button onClick={() => updateSensitivity(3)}>감도 초기화</button><button onClick={() => { setSettingsOpen(false); setAttempt(value => value + 1) }}>다시 연결</button></div>
      <p>{connected ? stats || '연결됨' : message}</p>
    </aside>}
    {helpOpen && <aside className="desktop-help"><strong>터치패드처럼 움직여 조작</strong>{connected && cursorMode && <p data-cursor-mode={cursorMode}>커서 표시: {cursorMode === 'local' ? '이 기기에서 즉시 표시' : '영상에 포함됨. 현재 화면에서는 커서 분리를 사용할 수 없습니다.'}</p>}<p>마우스 모양 아래쪽의 커서 이동 영역은 터치패드처럼 손가락을 움직인 만큼 커서를 옮깁니다. 손가락을 멈추면 커서도 멈추고, 떼었다 다시 대서 이어 움직일 수 있습니다. 위쪽 좌클릭·우클릭은 탭하면 클릭하고, 밀면 바로 버튼을 누른 채 드래그합니다. 휠은 밀어서 세로 스크롤하고, 잠깐 꾹 누른 뒤 밀면 중간 버튼으로 드래그합니다.</p><p>휠·화면 이동·확대도 움직인 만큼만 반응합니다. 화면 이동·확대는 내 화면에만 적용됩니다. 화면을 손가락으로 밀거나 두 손가락으로 확대할 수도 있습니다. 마지막 핸들로 조이스틱 전체를 옮기세요.</p>{relative && <p>이 서버는 조이스틱으로 커서를 이동합니다.</p>}<p>키보드: 화면 선택 후 입력 · F6: 도구로 이동 · Esc: 닫기</p></aside>}
    {pasteOpen && <form className="desktop-paste" onSubmit={event => { event.preventDefault(); input?.paste(text); setText(''); setPasteOpen(false); stage.current?.focus() }}><label htmlFor="desktop-paste">원격 컴퓨터에 붙여넣기</label><textarea id="desktop-paste" value={text} maxLength={4096} onChange={event => setText(event.target.value)} placeholder="전송할 텍스트" /><div><button type="button" onClick={() => { input?.key('Escape', true); input?.key('Escape', false) }}>원격 Esc</button><button type="submit" disabled={!connected || !text}>붙여넣기</button></div></form>}
    <DesktopFloating key={`keys-${layout}`} root={root} stage={stage} className="desktop-hotkeys" label="핫키">
      <div className="desktop-hotkey-buttons">
        {[
          ['Esc', ['Escape']], ['Tab', ['Tab']], ['Enter', ['Enter']], ['Backspace', ['Backspace']],
          [modifier === 'MetaLeft' ? 'Cmd+C' : 'Ctrl+C', [modifier, 'KeyC']],
          [modifier === 'MetaLeft' ? 'Cmd+V' : 'Ctrl+V', [modifier, 'KeyV']],
          [modifier === 'MetaLeft' ? 'Cmd+Z' : 'Ctrl+Z', [modifier, 'KeyZ']],
          [modifier === 'MetaLeft' ? 'Cmd+Tab' : 'Alt+Tab', [modifier === 'MetaLeft' ? 'MetaLeft' : 'AltLeft', 'Tab']],
        ].map(([label, keys]) => <button key={String(label)} disabled={!connected} aria-label={`원격 ${label}`} title={`원격 ${label}`} onClick={() => hotkey(keys as string[])}>{label as string}</button>)}
      </div>
    </DesktopFloating>
    <DesktopFloating key={`mouse-${layout}`} root={root} stage={stage} className="desktop-control-strip" label="원격 데스크톱 조이스틱">
      <div className="desktop-mouse">
        {(['left', 'wheel', 'right', 'cursor'] as const).map(kind => <DesktopStick key={kind} kind={kind} input={input} disabled={!connected} onView={onView} sensitivity={sensitivity} rotation={rotation} />)}
      </div>
      <div className="desktop-view-controls">
        {(['pan', 'zoom'] as const).map(kind => <DesktopStick key={kind} kind={kind} input={input} disabled={!connected} onView={onView} sensitivity={sensitivity} rotation={rotation} />)}
      </div>
    </DesktopFloating>
  </div>, document.body)}{install.popup}</>
}
