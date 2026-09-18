import { useCallback, useEffect, useRef } from 'react'
import { desktopStick, stickButton, type DesktopInput, type StickKind } from '../utils/desktop-input.ts'
import { DEFAULT_SENSITIVITY, rotateDelta, type Rotation } from '../utils/desktop-view.ts'

const labels: Record<StickKind, string> = { left: '좌클릭', wheel: '휠', right: '우클릭', cursor: '커서 이동', pan: '화면 이동', zoom: '확대·축소' }
export function DesktopIcon({ kind }: { kind: StickKind | 'handle' | 'close' | 'screen' | 'fullscreen' | 'rotate' | 'settings' }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'fullscreen' ? <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /> : kind === 'rotate' ? <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" /><path d="M9 9h6v6H9z" /></> : kind === 'settings' ? <><path d="M4 6h16M4 12h16M4 18h16" /><path d="M8 3v6m8 0v6m-6 0v6" /></> : kind === 'close' ? <path d="m6 6 12 12M6 18 18 6" /> : kind === 'screen' ? <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>
      : kind === 'cursor' ? <path d="m5 3 14 10-6 1-3 6Z" />
      : kind === 'pan' ? <path d="M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3" />
        : kind === 'zoom' ? <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6M7 10h6m-3-3v6" /></>
          : kind === 'handle' ? <path d="M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01" strokeWidth="3" />
            : <><rect x="5" y="2" width="14" height="20" rx="7" /><path d="M5 10h14M12 2v8" />{kind === 'left' ? <path d="M8.5 5v2" strokeWidth="3" /> : kind === 'right' ? <path d="M15.5 5v2" strokeWidth="3" /> : <path d="M12 5v3" strokeWidth="3" />}</>}
  </svg>
}

export function DesktopStick({ kind, input, disabled, onView, sensitivity = DEFAULT_SENSITIVITY, rotation = 0 }: { kind: StickKind; input: DesktopInput | null; disabled: boolean; onView: (x: number, y: number, zoom: number) => void; sensitivity?: number; rotation?: Rotation }) {
  const knob = useRef<HTMLSpanElement>(null), pointer = useRef<{ id: number; x: number; y: number } | null>(null)
  const machine = useRef<ReturnType<typeof desktopStick> | null>(null), frame = useRef(0), button = useRef<HTMLButtonElement>(null)
  const arrows = useRef(new Set<string>())
  const move = useCallback((x: number, y: number) => {
    const delta = rotateDelta(x * sensitivity, y * sensitivity, ((360 - rotation) % 360) as Rotation)
    input?.move(delta.x, delta.y)
  }, [input, sensitivity, rotation])
  const cancel = useCallback(() => {
    machine.current?.up(true); pointer.current = null; cancelAnimationFrame(frame.current)
    if (arrows.current.size && (kind === 'left' || kind === 'right')) input?.button(stickButton(kind), false)
    arrows.current.clear()
    if (knob.current) knob.current.style.transform = ''
    button.current?.removeAttribute('data-held')
  }, [input, kind])
  useEffect(() => {
    machine.current = input ? desktopStick(kind, { ...input, move }, onView) : null
    window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', cancel)
    return () => { cancel(); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', cancel) }
  }, [input, kind, onView, cancel, move])
  useEffect(() => { if (disabled) cancel() }, [disabled, cancel])
  return <button ref={button} className="desktop-stick" data-kind={kind} disabled={disabled} aria-label={`${labels[kind]} 조이스틱`}
    title={`${labels[kind]}${kind === 'wheel' ? ' · 탭: 중간 클릭 · 밀기: 스크롤 · 길게 누르기: 드래그' : stickButton(kind) ? ' · 탭: 클릭 · 밀기: 드래그' : ' · 밀어서 조작'}`}
    onBlur={cancel}
    onContextMenu={event => event.preventDefault()}
    onPointerDown={event => {
      if (pointer.current || !machine.current) return
      cancel()
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
      pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; machine.current.down(performance.now())
      const tick = (now: number) => {
        if (!pointer.current) return
        const result = machine.current!.tick(now)
        if (knob.current) knob.current.style.transform = `translate(${result.x}px, ${result.y}px)`
        button.current?.toggleAttribute('data-held', result.held)
        frame.current = requestAnimationFrame(tick)
      }
      frame.current = requestAnimationFrame(tick)
    }}
    onPointerMove={event => { if (pointer.current?.id === event.pointerId) machine.current?.move(event.clientX - pointer.current.x, event.clientY - pointer.current.y, performance.now()) }}
    onPointerUp={event => { if (pointer.current?.id === event.pointerId) { machine.current?.up(false); cancel() } }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}
    onKeyDown={event => {
      if (!event.key.startsWith('Arrow')) return
      event.preventDefault(); event.stopPropagation()
      if (pointer.current) return
      if (!arrows.current.size && (kind === 'left' || kind === 'right')) { input?.button(stickButton(kind), true); button.current?.setAttribute('data-held', '') }
      arrows.current.add(event.key)
      const x = event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0, y = event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0
      if (kind === 'pan') onView(x, y, 0)
      else if (kind === 'zoom') onView(0, 0, -y / 100)
      else if (kind === 'wheel') input?.wheel(0, y * 4)
      else move(x, y)
    }}
    onKeyUp={event => {
      if (!event.key.startsWith('Arrow')) return
      event.preventDefault(); event.stopPropagation()
      if (!arrows.current.delete(event.key) || arrows.current.size) return
      if (kind === 'left' || kind === 'right') input?.button(stickButton(kind), false)
      button.current?.removeAttribute('data-held')
    }}
    onClick={event => { if (event.detail === 0 && input && stickButton(kind)) input.click(stickButton(kind)) }}>
    <span className="desktop-stick-ring"><span ref={knob} className="desktop-stick-knob"><DesktopIcon kind={kind} /></span></span>
    <span className="desktop-stick-label">{labels[kind]}</span>
  </button>
}
