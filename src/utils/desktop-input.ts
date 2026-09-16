import type { DesktopCursor } from '../../native/remote-desktop/cursor-protocol.mjs'
export type InputSnapshot = { type: 'input'; v: 1; seq: number; epoch: number; x: number; y: number; wheelX: number; wheelY: number; buttons: number; keys: string[]; point?: [number, number] }
type Channel = { readyState: 'connecting' | 'open' | 'closing' | 'closed'; bufferedAmount: number; send(data: string): void }

/** Motion is cumulative, so an unreliable packet can be discarded without losing distance. */
export function desktopInput(onError: (message: string) => void = () => {}, onPoint: (x: number, y: number, joystick: boolean | undefined) => void = () => {}) {
  const state: InputSnapshot = { type: 'input', v: 1, seq: 0, epoch: 0, x: 0, y: 0, wheelX: 0, wheelY: 0, buttons: 0, keys: [] }
  let motion: Channel | null = null, control: Channel | null = null
  let pendingMotion = false, unconfirmedMotion = false, localCursor = false
  let remote: DesktopCursor | undefined, requiredSeq = 0, lastMotionAt = -Infinity, lastActivityAt = 0, lastWheelAt = -Infinity
  const activity = () => { pendingMotion = true; requiredSeq = state.seq + 1; lastActivityAt = performance.now() }
  const point = (x: number, y: number, joystick: boolean) => {
    const next: [number, number] = [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]
    if (localCursor) onPoint(next[0], next[1], joystick)
    if (state.point?.[0] === next[0] && state.point?.[1] === next[1]) return
    state.point = next; activity()
  }
  const send = (reliable: boolean) => {
    const channel = reliable ? control : motion
    if (channel?.readyState !== 'open') return
    // Never let movement sit in a network queue; the next snapshot recovers its distance.
    if (!reliable && channel.bufferedAmount > 2048) return
    if (reliable && channel.bufferedAmount > 64 * 1024) { onError('입력 연결이 지연됐습니다. 다시 연결해 주세요.'); return }
    if (reliable) state.epoch++
    state.seq++
    try {
      channel.send(JSON.stringify({ ...state, x: Math.trunc(state.x), y: Math.trunc(state.y), wheelX: Math.trunc(state.wheelX), wheelY: Math.trunc(state.wheelY) }))
      pendingMotion = false; unconfirmedMotion = !reliable; lastMotionAt = performance.now()
    }
    catch { onError('입력 연결이 종료됐습니다. 다시 연결해 주세요.') }
  }
  return {
    connect(name: string, channel: Channel) { if (name === 'motion') motion = channel; if (name === 'control') control = channel },
    localCursor(enabled: boolean) { localCursor = enabled; if (enabled && remote && !pendingMotion && remote.seq >= requiredSeq) { if (remote.x >= 0 && remote.x <= 1 && remote.y >= 0 && remote.y <= 1) state.point = [remote.x, remote.y]; onPoint(remote.x, remote.y, undefined) } },
    remoteCursor(value: DesktopCursor) {
      remote = value
      if (localCursor && !pendingMotion && value.seq >= requiredSeq) { if (value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1) state.point = [value.x, value.y]; onPoint(value.x, value.y, undefined) }
    },
    move(x: number, y: number) {
      if (localCursor && remote) { point((state.point?.[0] ?? .5) + x / Math.max(1, remote.width - 1), (state.point?.[1] ?? .5) + y / Math.max(1, remote.height - 1), true); return }
      delete state.point; state.x += x; state.y += y; activity()
    },
    point(x: number, y: number) { point(x, y, false) },
    wheel(x: number, y: number) { state.wheelX += x; state.wheelY += y; lastWheelAt = performance.now(); activity() },
    flushMotion(now?: number) {
      // A final reliable snapshot recovers the last lossy movement/scroll, without
      // waiting for the 250ms lease heartbeat. No per-pointer-event timer.
      if (now !== undefined && (pendingMotion || unconfirmedMotion) && now - lastActivityAt >= 70) { send(true); return }
      const interval = localCursor && !state.buttons && (now ?? performance.now()) - lastWheelAt > 100 ? 1000 / 30 : 1000 / 60
      if (pendingMotion && (now === undefined || now - lastMotionAt >= interval)) send(false)
    },
    button(bit: number, down: boolean) { state.buttons = down ? state.buttons | bit : state.buttons & ~bit; send(true) },
    key(code: string, down: boolean) { state.keys = state.keys.filter(key => key !== code); if (down && state.keys.length < 16) state.keys.push(code); send(true) },
    click(bit: number) { this.button(bit, true); this.button(bit, false) },
    paste(text: string) { this.release(); if (control?.readyState === 'open' && text.length <= 4096) { try { control.send(JSON.stringify({ type: 'paste', text })) } catch { onError('텍스트를 보내지 못했습니다. 다시 연결해 주세요.') } } },
    heartbeat() { send(true) },
    release() { state.buttons = 0; state.keys = []; send(true) },
    close() { this.release(); motion = null; control = null },
  }
}
export type DesktopInput = ReturnType<typeof desktopInput>

export type StickKind = 'left' | 'wheel' | 'right' | 'cursor' | 'pan' | 'zoom'
export const HOLD_MS = 320
export const STICK_TRAVEL = 8
export const stickButton = (kind: StickKind) => kind === 'left' ? 1 : kind === 'wheel' ? 2 : kind === 'right' ? 4 : 0

/** Touchpad deltas drive input; animation frames only update hold/visual feedback. */
export function desktopStick(kind: StickKind, input: Pick<DesktopInput, 'button' | 'click' | 'move' | 'wheel'>, view: (x: number, y: number, zoom: number) => void) {
  let active = false, moved = false, held = false, started = 0, x = 0, y = 0
  const hold = (now: number) => {
    if (active && !moved && !held && stickButton(kind) && now - started >= HOLD_MS) { held = true; input.button(stickButton(kind), true) }
  }
  return {
    down(now: number) { active = true; moved = false; held = false; started = now; x = 0; y = 0 },
    move(dx: number, dy: number, now: number) {
      if (!active) return
      hold(now)
      if (Math.hypot(dx, dy) >= 3) {
        moved = true
        // Press before the first movement snapshot, including a quick swipe.
        if (!held && (kind === 'left' || kind === 'right')) { held = true; input.button(stickButton(kind), true) }
      }
      // Keep the initial tap slop until movement starts, then preserve even tiny
      // reversals and motion beyond the visible knob's travel.
      if (!moved) return
      const deltaX = dx - x, deltaY = dy - y
      x = dx; y = dy
      if (!deltaX && !deltaY) return
      if (kind === 'pan') view(deltaX, deltaY, 0)
      else if (kind === 'zoom') { if (deltaY) view(0, 0, -deltaY / 100) }
      else if (kind === 'wheel' && !held) { if (deltaY) input.wheel(0, deltaY * 3) }
      else input.move(deltaX * 2, deltaY * 2)
    },
    tick(now: number) {
      if (!active) return { x: 0, y: 0, held: false }
      hold(now)
      const vertical = kind === 'zoom' || kind === 'wheel' && !held
      const length = Math.hypot(vertical ? 0 : x, y), ratio = length ? Math.min(STICK_TRAVEL, length) / length : 0
      return { x: vertical ? 0 : x * ratio, y: y * ratio, held }
    },
    up(cancel = false) {
      if (!active) return
      if (held) input.button(stickButton(kind), false)
      else if (!cancel && !moved && stickButton(kind)) input.click(stickButton(kind))
      active = false; held = false
    },
  }
}

export function clampView(view: { x: number; y: number; scale: number }, width: number, height: number, content = { width, height }) {
  const scale = Math.max(1, Math.min(6, view.scale))
  const limitX = Math.max(0, content.width * scale - width) / 2, limitY = Math.max(0, content.height * scale - height) / 2
  return { scale, x: Math.max(-limitX, Math.min(limitX, view.x)), y: Math.max(-limitY, Math.min(limitY, view.y)) }
}
