import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { canAutoFocusInput } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { SelectField, useOverlayDismiss } from '@mew/ui'
import { captureDesktopKeyboard } from '../utils/desktop-keyboard.ts'
import { desktopCursor } from '../utils/desktop-cursor.ts'
import { connectDesktop, type DesktopScreen, type DesktopState } from '../utils/desktop-connection.ts'
import { formatDesktopBytes, type DesktopNetworkUsage } from '../utils/desktop-network.ts'
import { clampView, type DesktopInput } from '../utils/desktop-input.ts'
import { KEY_CODES } from '../../native/remote-desktop/keys.mjs'
import { DesktopFloating } from './desktop-floating.tsx'
import { desktopGeometry, desktopLocalPoint, rotateDelta, readSensitivity, sensitivity as clampSensitivity, SENSITIVITY_KEY, type Rotation } from '../utils/desktop-view.ts'
import { DesktopIcon, DesktopStick } from './desktop-stick.tsx'
import { useDesktopInstall } from './desktop-install.tsx'
import { readDesktopVideo, saveDesktopVideo } from '../utils/desktop-video.ts'
import { VIDEO_FPS, type DesktopVideoSettings } from '../../native/remote-desktop/video-settings.mjs'
import './remote-desktop.css'

export function RemoteDesktop({ onClose, dockHostRef, mewcatHostRef, dockHidden = false }: { onClose: () => void; dockHostRef?: Ref<HTMLDivElement>; mewcatHostRef?: Ref<HTMLDivElement>; dockHidden?: boolean }) {
  useUiLocale()
  const root = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [panelSize, setPanelSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  const cursorImage = useRef<HTMLImageElement>(null), cursor = useRef<ReturnType<typeof desktopCursor> | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null), surface = useRef<'direct' | 'server'>('direct')
  const [transport, setTransport] = useState<'direct' | 'server'>('direct')
  const [cursorMode, setCursorMode] = useState<'local' | 'video' | null>(null)
  const session = useRef<ReturnType<typeof connectDesktop> | null>(null)
  const [state, setState] = useState<DesktopState>('preparing'), [message, setMessage] = useState(''), [stats, setStats] = useState('')
  const [network, setNetwork] = useState<DesktopNetworkUsage>({ received: 0, sent: 0 })
  const [screens, setScreens] = useState<DesktopScreen[]>([]), [selected, setSelected] = useState(''), [attempt, setAttempt] = useState(0)
  const preferred = useRef(''), [input, setInput] = useState<DesktopInput | null>(null), [relative, setRelative] = useState(false)
  const [videoSettings, setVideoSettings] = useState(readDesktopVideo)
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const [rotation, setRotation] = useState<Rotation>(0), [sensitivity, setSensitivity] = useState(readSensitivity)
  const [settingsOpen, setSettingsOpen] = useState(false), [fullscreen, setFullscreen] = useState(!!document.fullscreenElement), [fullscreenError, setFullscreenError] = useState('')
  const ownsFullscreen = useRef(false), [layout, setLayout] = useState(0), [modifier, setModifier] = useState('ControlLeft')
  const [hotkeysExpanded, setHotkeysExpanded] = useState(true)
  const [keyboardDetected, setKeyboardDetected] = useState(false)
  const [mouseDetected, setMouseDetected] = useState(() => window.matchMedia('(any-hover: hover) and (any-pointer: fine)').matches)
  useEffect(() => {
    const media = window.matchMedia('(any-hover: hover) and (any-pointer: fine)')
    const changed = () => setMouseDetected(media.matches)
    media.addEventListener('change', changed)
    changed()
    return () => media.removeEventListener('change', changed)
  }, [])
  const [viewport, setViewport] = useState({ width: 1, height: 1 }), [nativeSize, setNativeSize] = useState({ width: 1280, height: 720 })
  const geometry = desktopGeometry(viewport.width, viewport.height, nativeSize.width, nativeSize.height, 0, view)
  const projection = useRef(geometry); projection.current = geometry
  const settingsButton = useRef<HTMLButtonElement>(null), settingsPanel = useRef<HTMLElement>(null)
  const [keyboardState, setKeyboardState] = useState<'locked' | 'limited' | 'denied'>('limited')
  const [clipboardError, setClipboardError] = useState('')
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
  useOverlayDismiss(() => { if (!dismissInner()) close() }, { closeOnBack: () => !dismissInner(), closeOnEscape: event => {
    if (connected && !install.open && !settingsOpen && !pasteOpen && !helpOpen && (event.target === stage.current || event.target === root.current)) return false
    if (dismissInner()) { event.preventDefault(); event.stopPropagation() }
    return false
  } })
  const [installable, setInstallable] = useState(false)
  const install = useDesktopInstall(installable, () => setAttempt(value => value + 1))
  useEffect(() => {
    const element = root.current
    if (!element || !install.open) return
    element.inert = true
    return () => { element.inert = false; element.focus() }
  }, [install.open])

  const onView = useCallback((x: number, y: number, zoom: number) => {
    const element = stage.current
    if (!element) return
    setView(previous => clampView({ x: previous.x - x, y: previous.y - y, scale: previous.scale * Math.exp(zoom) }, element.clientWidth, element.clientHeight, projection.current.content))
  }, [])
  useLayoutEffect(() => {
    setViewport({ width: stage.current!.clientWidth, height: stage.current!.clientHeight })
  }, [rotation, panelSize])
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      setViewport({ width: stage.current!.clientWidth, height: stage.current!.clientHeight })
      setPanelSize({ width: root.current!.clientWidth, height: root.current!.clientHeight })
    })
    observer.observe(stage.current!)
    observer.observe(root.current!)
    const changed = () => { setFullscreen(!!document.fullscreenElement); if (!document.fullscreenElement) ownsFullscreen.current = false }
    document.addEventListener('fullscreenchange', changed)
    return () => { observer.disconnect(); document.removeEventListener('fullscreenchange', changed); if (ownsFullscreen.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {}) }
  }, [])
  useEffect(() => { onView(0, 0, 0) }, [viewport, nativeSize, rotation, onView])
  useEffect(() => { if (settingsOpen) if (canAutoFocusInput()) settingsPanel.current?.querySelector<HTMLInputElement>('input')?.focus() }, [settingsOpen])
  const toggleFullscreen = async () => {
    setFullscreenError('')
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (document.documentElement.requestFullscreen) { ownsFullscreen.current = true; await document.documentElement.requestFullscreen(); stage.current?.focus() }
      else setFullscreenError(uiText("이 브라우저는 전체화면을 지원하지 않습니다. 홈 화면에 추가한 앱으로 열어 주세요."))
    } catch { ownsFullscreen.current = false; setFullscreenError(uiText("전체화면으로 전환하지 못했습니다. 브라우저 권한을 확인하고 다시 눌러 주세요.")) }
  }
  const rotate = () => { input?.release(); touches.current.clear(); setRotation(value => ((value + 90) % 360) as Rotation); setView({ x: 0, y: 0, scale: 1 }); setLayout(value => value + 1); stage.current?.focus() }
  const updateSensitivity = (value: number) => {
    const next = clampSensitivity(value); setSensitivity(next)
    try { scopedBrowserStorage().setItem(SENSITIVITY_KEY, JSON.stringify(next)) } catch { /* Session setting still works without storage. */ }
  }
  const updateVideo = (patch: Partial<DesktopVideoSettings>) => {
    const next = { ...videoSettings, ...patch }
    saveDesktopVideo(next); setVideoSettings(next); setAttempt(value => value + 1)
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
    setStats(''); setNetwork({ received: 0, sent: 0 }); setRelative(false); setInstallable(false); setCursorMode(null); setView({ x: 0, y: 0, scale: 1 })
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
        if (!context) throw new Error(uiText("원격 화면을 표시할 수 없습니다."))
        context.drawImage(frame, 0, 0)
        if (resized) { setNativeSize({ width: frame.displayWidth, height: frame.displayHeight }); local.refresh() }
      },
      transport: mode => { surface.current = mode; setTransport(mode); setStats(''); if (mode === 'server' && video.current) video.current.srcObject = null },
      relative: setRelative, stats: setStats, network: setNetwork, installable: setInstallable,
    }, preferred.current, videoSettings)
    session.current = connection; setInput(connection.input)
    const hide = () => {
      if (document.hidden) { connection.close(); setState('paused'); setMessage(uiText("앱이 백그라운드로 이동해 연결을 종료했습니다.")) }
    }
    const release = () => { try { connection.input.release() } catch { connection.fail(uiText("입력 연결이 지연됐습니다. 다시 연결해 주세요.")) } }
    window.addEventListener('blur', release); document.addEventListener('visibilitychange', hide)
    return () => { local.close(); cursor.current = null; if (session.current === connection) session.current = null; connection.close(); window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', hide); if (element) element.srcObject = null }
  }, [attempt, videoSettings])
  useEffect(() => { cursor.current?.refresh() }, [view, transport, rotation, viewport, nativeSize])

  const copyClipboard = async () => {
    const connection = session.current
    if (!connected || !connection) return
    setClipboardError('')
    try {
      const value = await connection.input.readClipboard()
      if (session.current !== connection || document.hidden) return
      await navigator.clipboard.writeText(value)
    } catch { if (session.current === connection) setClipboardError(uiText("클립보드를 공유하지 못했습니다. 브라우저 권한과 원격 텍스트 크기를 확인하세요.")) }
  }
  const pasteClipboard = async (allowed: () => boolean = () => true) => {
    const connection = session.current
    if (!connected || !connection) return false
    setClipboardError('')
    try {
      const value = await navigator.clipboard.readText()
      if (session.current !== connection || document.hidden || !allowed()) return false
      if (value.length > 4096 || value.includes('\0')) throw new Error('Clipboard text too large')
      connection.input.paste(value)
      return true
    } catch {
      if (session.current === connection) setClipboardError(uiText("클립보드를 공유하지 못했습니다. 브라우저 권한과 원격 텍스트 크기를 확인하세요."))
      return false
    }
  }
  useEffect(() => {
    if (!connected || !input || install.open || settingsOpen || pasteOpen || helpOpen) { setKeyboardState('limited'); return }
    return captureDesktopKeyboard({ input, target: element => element === root.current || element === stage.current,
      detected: () => setKeyboardDetected(true), copy: copyClipboard, paste: pasteClipboard, status: value => { setKeyboardState(value); if (value === 'denied') setFullscreenError(uiText("키보드 잠금이 거부됐습니다. 브라우저 권한을 확인하세요.")) } })
    // Clipboard handlers use the connection captured for this effect's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, input, install.open, settingsOpen, pasteOpen, helpOpen])

  const sendKey = (event: KeyboardEvent, down: boolean) => {
    event.stopPropagation()
    if (down && event.isTrusted && !event.nativeEvent.isComposing && KEY_CODES[event.code] && (event.target === stage.current || event.target === root.current)) setKeyboardDetected(true)
    if (event.key === 'Escape') { if (down) dismissInner(); return }
    if (event.key === 'F6') { event.preventDefault(); if (down) root.current?.querySelector<HTMLButtonElement>('.desktop-tools button')?.focus(); return }
    // Only the actual viewport takes remote keyboard input; the toolbar remains accessible.
    if (event.target !== stage.current && event.target !== root.current) return
    if (connected && KEY_CODES[event.code]) { event.preventDefault(); if (!event.repeat) input?.key(event.code, down) }
  }
  const directPoint = (clientX: number, clientY: number, clamp = false) => {
    if (!stage.current || relative) return false
    const point = desktopLocalPoint(stage.current, clientX, clientY, rotation)
    const { x, y } = projection.current.unproject(point.x, point.y)
    if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return false
    input?.point(x, y); return true
  }
  const syncVideoSize = () => {
    const width = video.current?.videoWidth, height = video.current?.videoHeight
    if (!width || !height) return
    setNativeSize(previous => previous.width === width && previous.height === height ? previous : { width, height })
    cursor.current?.refresh()
  }
  const mediaStyle = { width: geometry.width, height: geometry.height, transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})` }
  const swapped = rotation === 90 || rotation === 270
  return <>{createPortal(<div ref={root} className="remote-desktop" data-dock={!!dockHostRef && !dockHidden && !fullscreen || undefined} role="dialog" aria-modal="true" aria-labelledby="desktop-title" tabIndex={-1}
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
    <div ref={mewcatHostRef} data-desktop-mewcat-host onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()} />
    <div ref={panel} className="desktop-panel" data-rotation={rotation} style={{ width: swapped ? panelSize.height : panelSize.width, height: swapped ? panelSize.width : panelSize.height, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}>
    <header className="desktop-toolbar">
      <div className="desktop-title"><DesktopIcon kind="screen" /><strong id="desktop-title">{uiText("원격 데스크톱")}</strong><span className="desktop-status" data-connected={connected}>{connected ? stats || uiText("연결됨") : state === 'error' ? uiText("연결 실패") : state === 'paused' ? uiText("연결 종료") : uiText("연결 중")}</span>
        <span className="desktop-network" aria-label={uiText("세션 네트워크 사용량: 수신 {received}, 송신 {sent}", { received: formatDesktopBytes(network.received), sent: formatDesktopBytes(network.sent) })} title={uiText("세션 네트워크 사용량: 수신 {received}, 송신 {sent}", { received: formatDesktopBytes(network.received), sent: formatDesktopBytes(network.sent) })}>{uiText("누적 {total}", { total: formatDesktopBytes(network.received + network.sent) })}</span>
      </div>
      <div ref={dockHostRef} hidden={fullscreen || dockHidden} className="desktop-dock-host" />
      <div className="desktop-tools">
        <button onClick={() => { setView({ x: 0, y: 0, scale: 1 }); stage.current?.focus() }} title={uiText("화면에 맞추기")}>{uiText("맞춤")}<span className="desktop-scale">{Math.round(view.scale * 100)}%</span></button>
        <button disabled={!connected} onClick={() => { input?.release(); setPasteOpen(value => !value); setHelpOpen(false); setSettingsOpen(false) }} aria-expanded={pasteOpen}>{uiText("입력")}</button>
        <button onClick={() => { setHelpOpen(value => !value); setPasteOpen(false); setSettingsOpen(false) }} aria-expanded={helpOpen}>{uiText("도움말")}</button>
        <button className="desktop-tool-icon" onClick={rotate} aria-label={uiText("화면 90도 회전")} title={uiText("화면 90도 회전 · 현재 {p0}°", { p0: rotation })}><DesktopIcon kind="rotate" /></button>
        <button className="desktop-tool-icon" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? uiText("전체화면 해제") : uiText("전체화면")} aria-pressed={fullscreen} title={fullscreen ? uiText("전체화면 해제") : uiText("전체화면")}><DesktopIcon kind="fullscreen" /></button>
        <button ref={settingsButton} className="desktop-tool-icon" aria-label={uiText("원격 데스크톱 설정")} title={uiText("원격 데스크톱 설정")} aria-expanded={settingsOpen} aria-controls="desktop-settings" onClick={() => { input?.release(); setSettingsOpen(value => !value); setHelpOpen(false); setPasteOpen(false) }}><DesktopIcon kind="settings" /></button>
        <button className="desktop-close" aria-label={uiText("원격 데스크톱 닫기")} onClick={close}><DesktopIcon kind="close" /></button>
      </div>
    </header>
    {fullscreenError && <div className="desktop-notice" role="status">{fullscreenError}<button onClick={() => setFullscreenError('')} aria-label={uiText("전체화면 안내 닫기")}><DesktopIcon kind="close" /></button></div>}
    {clipboardError && !pasteOpen && <div className="desktop-notice" role="status">{clipboardError}<button onClick={() => setClipboardError('')} aria-label={uiText("닫기")}><DesktopIcon kind="close" /></button></div>}
    <div ref={stage} className="desktop-stage" tabIndex={0} aria-label={uiText("원격 화면. 키보드 입력을 전달하려면 선택하세요.")}
      onBlur={() => input?.release()} onContextMenu={event => event.preventDefault()}
      onPointerDown={event => {
        if (!connected) return
        if (event.pointerType === 'mouse') setMouseDetected(true)
        else if (event.pointerType === 'touch' && !window.matchMedia('(any-hover: hover) and (any-pointer: fine)').matches) setMouseDetected(false)
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
          } else { const delta = rotateDelta(previous.x - event.clientX, previous.y - event.clientY, ((360 - rotation) % 360) as Rotation); onView(delta.x, delta.y, 0) }
          touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        } else if (event.pointerType !== 'touch') { if (event.pointerType === 'mouse') setMouseDetected(true); cursor.current?.mouse(); directPoint(event.clientX, event.clientY, event.buttons !== 0) }
      }}
      onPointerUp={event => { touches.current.delete(event.pointerId); if (event.pointerType !== 'touch' && connected) { directPoint(event.clientX, event.clientY, true); input?.button(event.button === 2 ? 4 : event.button === 1 ? 2 : 1, false) } }}
      onPointerCancel={() => { touches.current.clear(); input?.release() }}
      onLostPointerCapture={() => { touches.current.clear(); input?.release() }}
      onWheel={event => { if (connected && directPoint(event.clientX, event.clientY)) { event.preventDefault(); input?.wheel(event.deltaX * (event.deltaMode === 1 ? 40 : 1), event.deltaY * (event.deltaMode === 1 ? 40 : 1)) } }}>
      <video ref={video} autoPlay playsInline muted onLoadedMetadata={syncVideoSize} onResize={syncVideoSize} className="desktop-video" style={{ ...mediaStyle, display: transport === 'direct' ? 'block' : 'none' }} />
      <canvas ref={canvas} className="desktop-video" aria-hidden="true" style={{ ...mediaStyle, display: transport === 'server' ? 'block' : 'none' }} />
      <img ref={cursorImage} className="desktop-cursor" alt="" aria-hidden="true" hidden />
      {!connected && <div className="desktop-connection" role={state === 'error' ? 'alert' : 'status'}>
        <h2>{state === 'error' ? uiText("화면을 연결하지 못했어요") : state === 'paused' ? uiText("연결이 종료됐어요") : uiText("서버 화면 연결 중")}</h2><p>{message}</p>
        {(installable || state === 'error' || state === 'paused') && <div className="desktop-connection-actions">
          {installable && install.actions}
          {(state === 'error' || state === 'paused') && <button onClick={() => setAttempt(value => value + 1)}>{uiText("다시 연결")}</button>}
        </div>}
        {installable && install.error && <p className="select-text desktop-install-error">{install.error}</p>}
      </div>}
    </div>
    {settingsOpen && <aside ref={settingsPanel} id="desktop-settings" className="desktop-settings" aria-label={uiText("원격 데스크톱 설정")}>
      <div className="desktop-settings-heading"><strong>{uiText("원격 데스크톱 설정")}</strong><button aria-label={uiText("설정 닫기")} onClick={() => { setSettingsOpen(false); settingsButton.current?.focus() }}><DesktopIcon kind="close" /></button></div>
      <label className="desktop-setting-label" htmlFor="desktop-sensitivity">{uiText("마우스 커서 감도")}<output htmlFor="desktop-sensitivity">{sensitivity.toFixed(1)}{uiText("배")}</output></label>
      <input id="desktop-sensitivity" type="range" min="0.5" max="6" step="0.1" value={sensitivity} onChange={event => updateSensitivity(Number(event.target.value))} aria-describedby="desktop-sensitivity-help" />
      <p id="desktop-sensitivity-help">{uiText("빠르게 밀수록 커서가 더 멀리 움직이고, 천천히 밀면 정밀하게 움직입니다. 감도는 이 이동량에 곱하며 기본은 3배입니다. 화면 직접 클릭과 휠 속도는 유지됩니다.")}</p>
      <label className="desktop-setting-label" htmlFor="desktop-screen">{uiText("공유 화면")}</label>
      <SelectField id="desktop-screen" label={uiText("공유 화면")} disabled={!screens.length} value={selected} portalContainer={panel.current}
        onChange={value => { preferred.current = value; setAttempt(value => value + 1) }} options={screens.map(screen => ({ value: screen.id, label: screen.label }))} />
      <label className="desktop-setting-label" htmlFor="desktop-resolution">{uiText("영상 해상도")}</label>
      <SelectField id="desktop-resolution" label={uiText("영상 해상도")} value={videoSettings.resolution} portalContainer={panel.current}
        onChange={value => updateVideo({ resolution: value as DesktopVideoSettings['resolution'] })} options={[{ value: '720p', label: 'HD · 720p' }, { value: '1080p', label: 'Full HD · 1080p' }, { value: '1440p', label: 'QHD · 1440p' }, { value: '2160p', label: '4K · 2160p' }]} />
      <label className="desktop-setting-label" htmlFor="desktop-fps">{uiText("목표 FPS")}</label>
      <SelectField id="desktop-fps" label={uiText("목표 FPS")} value={String(videoSettings.fps)} portalContainer={panel.current}
        onChange={value => updateVideo({ fps: Number(value) as DesktopVideoSettings['fps'] })} options={VIDEO_FPS.map(fps => ({ value: String(fps), label: `${fps} FPS` }))} />
      <label className="desktop-setting-label" htmlFor="desktop-quality">{uiText("영상 품질")}</label>
      <SelectField id="desktop-quality" label={uiText("영상 품질")} value={videoSettings.quality} portalContainer={panel.current}
        onChange={value => updateVideo({ quality: value as DesktopVideoSettings['quality'] })} options={[{ value: 'balanced', label: uiText("균형") }, { value: 'high', label: uiText("고화질") }]} />
      <p>{uiText("변경하면 다시 연결합니다. 화면·GPU·브라우저가 지원하는 범위로 조정하며, 고화질은 더 많은 대역폭을 사용합니다.")}</p>
      <label className="desktop-setting-label" htmlFor="desktop-modifier">{uiText("핫키 보조키")}</label>
      <SelectField id="desktop-modifier" label={uiText("핫키 보조키")} value={modifier} onChange={setModifier} portalContainer={panel.current}
        options={[{ value: 'ControlLeft', label: 'Ctrl · Windows / Linux' }, { value: 'MetaLeft', label: 'Cmd · Mac' }]} />
      <div className="desktop-settings-actions"><button onClick={() => { input?.release(); setLayout(value => value + 1) }}>{uiText("버튼 위치 초기화")}</button><button onClick={() => updateSensitivity(3)}>{uiText("감도 초기화")}</button><button onClick={() => { setSettingsOpen(false); setAttempt(value => value + 1) }}>{uiText("다시 연결")}</button></div>
      <p role="status" data-keyboard-state={keyboardState}>{keyboardState === 'locked' ? uiText("키보드 잠금 활성화 · OS 예약 키는 제외될 수 있습니다.") : keyboardState === 'denied' ? uiText("키보드 잠금이 거부됐습니다. 브라우저 권한을 확인하세요.") : uiText("키보드 잠금은 지원 브라우저의 전체화면에서 원격 화면을 선택하면 활성화됩니다.")}</p>
      <p>{connected ? stats || uiText("연결됨") : message}</p>
    </aside>}
    {helpOpen && <aside className="desktop-help"><strong>{uiText("터치패드처럼 움직여 조작")}</strong>{connected && cursorMode && <p data-cursor-mode={cursorMode}>{uiText("커서 표시:")}{cursorMode === 'local' ? uiText("이 기기에서 즉시 표시") : uiText("영상에 포함됨. 현재 화면에서는 커서 분리를 사용할 수 없습니다.")}</p>}<p>{uiText("마우스 모양 아래쪽의 커서 이동 영역은 터치패드처럼 손가락을 움직인 만큼 커서를 옮깁니다. 손가락을 멈추면 커서도 멈추고, 떼었다 다시 대서 이어 움직일 수 있습니다. 위쪽 좌클릭·우클릭은 탭하면 클릭하고, 밀면 바로 버튼을 누른 채 드래그합니다. 휠은 밀어서 세로 스크롤하고, 잠깐 꾹 누른 뒤 밀면 중간 버튼으로 드래그합니다.")}</p><p>{uiText("휠·화면 이동·확대는 중앙에서 멀리 밀수록 빨라지고, 밀어 둔 동안 계속 작동합니다. 중앙으로 돌아오거나 손을 떼면 멈춥니다. 화면 이동·확대는 내 화면에만 적용됩니다. 화면을 손가락으로 밀거나 두 손가락으로 확대할 수도 있습니다. 마지막 핸들로 조이스틱 전체를 옮기세요.")}</p>{relative && <p>{uiText("이 서버는 조이스틱으로 커서를 이동합니다.")}</p>}<p>{uiText("키보드는 원격 화면으로 전달됩니다. 도구와 닫기는 마우스로 선택하세요. 전체화면 키보드 잠금은 Esc를 길게 눌러 해제할 수 있습니다.")}</p></aside>}
    {pasteOpen && <form className="desktop-paste" onSubmit={event => { event.preventDefault(); try { input?.paste(text); setText(''); setPasteOpen(false); stage.current?.focus() } catch { setClipboardError(uiText("클립보드를 공유하지 못했습니다. 브라우저 권한과 원격 텍스트 크기를 확인하세요.")) } }}><label htmlFor="desktop-paste">{uiText("원격 컴퓨터에 붙여넣기")}</label><textarea id="desktop-paste" value={text} maxLength={4096} onChange={event => setText(event.target.value)} placeholder={uiText("전송할 텍스트")} />{clipboardError && <p role="status">{clipboardError}</p>}<div><button type="button" disabled={!connected} onClick={() => void copyClipboard()}>{uiText("원격 클립보드 가져오기")}</button><button type="button" disabled={!connected} onClick={() => void pasteClipboard()}>{uiText("내 클립보드 붙여넣기")}</button><button type="button" onClick={() => { input?.key('Escape', true); input?.key('Escape', false) }}>{uiText("원격 Esc")}</button><button type="submit" disabled={!connected || !text}>{uiText("붙여넣기")}</button></div></form>}
    {!keyboardDetected && <DesktopFloating key={`keys-${layout}`} root={panel} stage={stage} rotation={rotation} className={`desktop-hotkeys${hotkeysExpanded ? '' : ' is-collapsed'}`} label={uiText("핫키")}>
      <button type="button" className="desktop-hotkey-toggle" aria-expanded={hotkeysExpanded} aria-controls="desktop-hotkey-buttons" aria-label={`${uiText("핫키")} ${hotkeysExpanded ? uiText("접기") : uiText("펼치기")}`} title={hotkeysExpanded ? uiText("접기") : uiText("펼치기")} onClick={() => setHotkeysExpanded(value => !value)}>
        <DesktopIcon kind={hotkeysExpanded ? 'collapse' : 'expand'} />
      </button>
      <div id="desktop-hotkey-buttons" className="desktop-hotkey-buttons" hidden={!hotkeysExpanded}>
        {[
          ['Esc', ['Escape']], ['Tab', ['Tab']], ['Enter', ['Enter']], ['Backspace', ['Backspace']],
          [modifier === 'MetaLeft' ? 'Cmd+C' : 'Ctrl+C', [modifier, 'KeyC']],
          [modifier === 'MetaLeft' ? 'Cmd+V' : 'Ctrl+V', [modifier, 'KeyV']],
          [modifier === 'MetaLeft' ? 'Cmd+Z' : 'Ctrl+Z', [modifier, 'KeyZ']],
          [modifier === 'MetaLeft' ? 'Cmd+Tab' : 'Alt+Tab', [modifier === 'MetaLeft' ? 'MetaLeft' : 'AltLeft', 'Tab']],
        ].map(([label, keys]) => <button key={String(label)} disabled={!connected} aria-label={uiText("원격 {p0}", { p0: label })} title={uiText("원격 {p0}", { p0: label })} onClick={() => hotkey(keys as string[])}>{label as string}</button>)}
      </div>
    </DesktopFloating>}
    {!mouseDetected && <DesktopFloating key={`mouse-${layout}`} root={panel} stage={stage} rotation={rotation} className="desktop-control-strip" label={uiText("원격 데스크톱 조이스틱")}>
      <div className="desktop-mouse">
        {(['left', 'wheel', 'right', 'cursor'] as const).map(kind => <DesktopStick key={kind} kind={kind} input={input} disabled={!connected} onView={onView} sensitivity={sensitivity} rotation={rotation} />)}
      </div>
      <div className="desktop-view-controls">
        {(['pan', 'zoom'] as const).map(kind => <DesktopStick key={kind} kind={kind} input={input} disabled={!connected} onView={onView} sensitivity={sensitivity} rotation={rotation} />)}
      </div>
    </DesktopFloating>}
    </div>
  </div>, document.body)}{install.popup}</>
}
