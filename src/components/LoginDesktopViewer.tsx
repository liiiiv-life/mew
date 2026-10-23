import { useEffect, useRef, useState } from 'react'
import { Refresh } from 'iconoir-react'
import { DesktopIcon } from './desktop-stick'
import { HoverTipLayer } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { openMewSocket } from '../utils/remote-transport'
import { LOGIN_DESKTOP_LIMITS, loginDesktopSize, type LoginDesktopInput, type LoginDesktopState } from '../../shared/login-desktop'

type Size = { width: number; height: number }
type LoginState = 'connecting' | 'ready' | 'error' | 'closed'

/** Native browser pixels and input remain inside the server's isolated login display. */
export function LoginDesktopViewer({ streamUrl, reopen, onReady }: { streamUrl: string; reopen: () => Promise<string>; onReady?: () => void }) {
  useUiLocale()
  const surface = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const keyboard = useRef<HTMLTextAreaElement>(null)
  const socket = useRef<WebSocket | null>(null)
  const size = useRef<Size>({ width: 960, height: 640 })
  const heldKeys = useRef(new Map<string, string>())
  const heldButtons = useRef(new Set<number>())
  const readyCallback = useRef(onReady)
  readyCallback.current = onReady
  const [connection, setConnection] = useState({ url: streamUrl, attempt: 0 })
  const [state, setState] = useState<LoginState>('connecting')
  const [error, setError] = useState('')
  const [reopening, setReopening] = useState(false)
  const send = (message: LoginDesktopInput) => {
    const ws = socket.current
    if (ws?.readyState !== WebSocket.OPEN) return
    try { ws.send(JSON.stringify(message)) } catch { setState('error'); setError(uiText('로그인 화면에 연결하지 못했습니다. 다시 연결해 주세요.')) }
  }
  const releaseInputs = () => {
    for (const [code, key] of heldKeys.current) send({ type: 'key', code, key, down: false })
    for (const button of heldButtons.current) send({ type: 'button', button, down: false })
    heldKeys.current.clear(); heldButtons.current.clear()
  }

  useEffect(() => {
    let disposed = false, ended = false, notified = false, shown = '', pending = '', queued: Blob | null = null
    setState('connecting'); setError('')
    const display = (blob: Blob) => {
      if (disposed || !image.current) return
      if (pending) { queued = blob; return }
      pending = URL.createObjectURL(blob)
      image.current.src = pending
    }
    const loaded = () => {
      if (shown) URL.revokeObjectURL(shown)
      shown = pending; pending = ''
      if (disposed || ended) return
      send({ type: 'frame-ack' })
      setState('ready')
      if (!notified) { notified = true; readyCallback.current?.() }
      if (queued) { const next = queued; queued = null; display(next) }
    }
    const failedImage = () => {
      if (pending) URL.revokeObjectURL(pending)
      pending = ''
      if (!disposed && !ended) send({ type: 'frame-ack' })
      if (queued) { const next = queued; queued = null; display(next) }
    }
    const element = image.current
    element?.addEventListener('load', loaded)
    element?.addEventListener('error', failedImage)
    let ws: WebSocket
    try { ws = openMewSocket(new URL(connection.url, location.href).href) }
    catch (cause) { element?.removeEventListener('load', loaded); element?.removeEventListener('error', failedImage); setState('error'); setError(cause instanceof Error ? cause.message : uiText('로그인 화면에 연결하지 못했습니다.')); return }
    socket.current = ws
    ws.binaryType = 'blob'
    let lastSize = '', resizeTimer: ReturnType<typeof setTimeout> | undefined
    const resize = () => {
      const bounds = surface.current?.getBoundingClientRect()
      if (!bounds || bounds.width <= 0 || bounds.height <= 0 || ws.readyState !== WebSocket.OPEN) return
      const dimensions = loginDesktopSize(bounds.width, bounds.height), nextSize = `${dimensions.width}:${dimensions.height}`
      if (nextSize !== lastSize) { lastSize = nextSize; ws.send(JSON.stringify({ type: 'resize', ...dimensions })) }
    }
    const observer = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 150) })
    if (surface.current) observer.observe(surface.current)
    ws.onopen = resize
    ws.onmessage = ({ data }) => {
      if (disposed) return
      if (typeof data !== 'string') { display(data instanceof Blob ? data : new Blob([data], { type: 'image/jpeg' })); return }
      try {
        const message = JSON.parse(data) as LoginDesktopState
        if ((message.type === 'ready' || message.type === 'size') && Number.isFinite(message.width) && Number.isFinite(message.height) && message.width > 0 && message.height > 0) size.current = { width: message.width, height: message.height }
        else if (message.type === 'error') { ended = true; setState('error'); setError(typeof message.message === 'string' ? message.message : uiText('로그인 화면에 연결하지 못했습니다.')) }
        else if (message.type === 'closed') { ended = true; setState('closed') }
      } catch { setState('error'); setError(uiText('로그인 화면의 응답이 올바르지 않습니다.')) }
    }
    ws.onerror = () => { ended = true; if (!disposed) { setState('error'); setError(uiText('로그인 화면에 연결하지 못했습니다. 다시 연결해 주세요.')) } }
    ws.onclose = () => { ended = true; if (!disposed) setState(current => current === 'error' ? current : 'closed') }
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation()
      if (!ended && notified && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'wheel', deltaX: event.deltaX, deltaY: event.deltaY }))
    }
    const stage = surface.current
    stage?.addEventListener('wheel', wheel, { passive: false })
    const blur = () => releaseInputs()
    window.addEventListener('blur', blur)
    return () => {
      releaseInputs(); disposed = true; socket.current = null
      observer.disconnect(); clearTimeout(resizeTimer)
      ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null; ws.close()
      window.removeEventListener('blur', blur)
      stage?.removeEventListener('wheel', wheel)
      element?.removeEventListener('load', loaded); element?.removeEventListener('error', failedImage)
      if (shown) URL.revokeObjectURL(shown)
      if (pending) URL.revokeObjectURL(pending)
    }
  }, [connection])

  const point = (clientX: number, clientY: number) => {
    const bounds = surface.current!.getBoundingClientRect(), dimensions = size.current
    const scale = Math.min(bounds.width / dimensions.width, bounds.height / dimensions.height)
    const left = bounds.left + (bounds.width - dimensions.width * scale) / 2, top = bounds.top + (bounds.height - dimensions.height * scale) / 2
    return { x: Math.round(Math.max(0, Math.min(dimensions.width - 1, (clientX - left) / scale))), y: Math.round(Math.max(0, Math.min(dimensions.height - 1, (clientY - top) / scale))) }
  }
  const reconnect = async () => {
    setReopening(true)
    try { const url = await reopen(); setConnection(current => ({ url, attempt: current.attempt + 1 })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : uiText('다시 연결하지 못했습니다.')); setState('error') }
    finally { setReopening(false) }
  }
  const iconButton = 'flex h-7 w-7 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40'
  return <HoverTipLayer className="relative flex h-full min-h-0 flex-1 flex-col bg-surface-deep text-ink">
    <div className="flex h-8 shrink-0 items-center justify-end gap-1 border-b border-edge bg-surface px-1">
      <button type="button" className={iconButton} aria-label={uiText('키보드 입력')} data-tip={uiText('키보드 입력')} disabled={state !== 'ready'} onClick={() => keyboard.current?.focus()}><DesktopIcon kind="keyboard" /></button>
      <button type="button" className={iconButton} aria-label={uiText('다시 연결')} data-tip={uiText('다시 연결')} disabled={reopening || state === 'connecting'} onClick={() => void reconnect()}><Refresh width={16} height={16} aria-hidden="true" /></button>
    </div>
    <div ref={surface} data-login-desktop tabIndex={0} role="application" aria-label={uiText('로그인 화면')} className="relative min-h-0 flex-1 touch-none overflow-hidden bg-black focus-visible:outline-2 focus-visible:outline-accent"
      onContextMenu={event => event.preventDefault()}
      onPointerDown={event => { if (state !== 'ready' || event.button > 2) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); heldButtons.current.add(event.button); send({ type: 'button', button: event.button, down: true, ...point(event.clientX, event.clientY) }) }}
      onPointerMove={event => { if (state === 'ready') send({ type: 'pointer', ...point(event.clientX, event.clientY) }) }}
      onPointerUp={event => { heldButtons.current.delete(event.button); send({ type: 'button', button: event.button, down: false, ...point(event.clientX, event.clientY) }) }}
      onPointerCancel={releaseInputs}
      onKeyDown={event => { if (event.target === keyboard.current || state !== 'ready' || event.nativeEvent.isComposing) return; event.stopPropagation(); if (!event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { releaseInputs(); return }; event.preventDefault(); heldKeys.current.set(event.code, event.key); send({ type: 'key', key: event.key, code: event.code, down: true }) }}
      onKeyUp={event => { if (event.target === keyboard.current || !heldKeys.current.has(event.code)) return; event.preventDefault(); event.stopPropagation(); heldKeys.current.delete(event.code); send({ type: 'key', key: event.key, code: event.code, down: false }) }}
      onPaste={event => { event.preventDefault(); event.stopPropagation(); releaseInputs(); const text = event.clipboardData.getData('text/plain'); if (state === 'ready' && text) send({ type: 'paste', text: text.slice(0, LOGIN_DESKTOP_LIMITS.pasteChars) }) }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) releaseInputs() }}>
      <img ref={image} alt={uiText('서버의 로그인 화면')} draggable={false} className="pointer-events-none h-full w-full select-none object-contain" />
      <textarea ref={keyboard} aria-label={uiText('로그인 키보드 입력')} autoCapitalize="off" autoCorrect="off" spellCheck={false} className="absolute bottom-0 left-0 h-px w-px opacity-0" onChange={event => { if (event.nativeEvent instanceof InputEvent && event.nativeEvent.isComposing) return; if (event.target.value) { send({ type: 'paste', text: event.target.value.slice(0, LOGIN_DESKTOP_LIMITS.pasteChars) }); event.target.value = '' } }} onCompositionEnd={event => { if (event.currentTarget.value) { send({ type: 'paste', text: event.currentTarget.value.slice(0, LOGIN_DESKTOP_LIMITS.pasteChars) }); event.currentTarget.value = '' } }} onKeyDown={event => { event.stopPropagation(); if (['Enter', 'Tab', 'Backspace', 'Escape'].includes(event.key)) { event.preventDefault(); send({ type: 'key', key: event.key, code: event.code, down: true }); send({ type: 'key', key: event.key, code: event.code, down: false }) } }} />
    </div>
    {state === 'connecting' && <div role="status" className="pointer-events-none absolute right-2 top-10 rounded bg-surface px-2 py-1 text-xs text-ink-secondary">{uiText('로그인 화면에 연결 중…')}</div>}
    {(state === 'error' || state === 'closed') && <div role="alert" className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded bg-surface-raised p-2 text-xs shadow-lg"><span className="min-w-0 flex-1 select-text break-words">{error || uiText('로그인 화면 연결이 종료됐습니다.')}</span><button type="button" className={iconButton} aria-label={uiText('다시 연결')} data-tip={uiText('다시 연결')} disabled={reopening} onClick={() => void reconnect()}><Refresh width={16} height={16} aria-hidden="true" /></button></div>}
  </HoverTipLayer>
}
