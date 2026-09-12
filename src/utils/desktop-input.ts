export type InputSnapshot = { type: 'input'; v: 1; seq: number; epoch: number; x: number; y: number; wheelX: number; wheelY: number; buttons: number; keys: string[]; point?: [number, number] }
type Channel = Pick<RTCDataChannel, 'readyState' | 'bufferedAmount' | 'send'>

/** Motion is cumulative, so an unreliable packet can be discarded without losing distance. */
export function desktopInput(onError: (message: string) => void = () => {}) {
  const state: InputSnapshot = { type: 'input', v: 1, seq: 0, epoch: 0, x: 0, y: 0, wheelX: 0, wheelY: 0, buttons: 0, keys: [] }
  let motion: Channel | null = null, control: Channel | null = null
  let pendingMotion = false
  const send = (reliable: boolean) => {
    const channel = reliable ? control : motion
    if (channel?.readyState !== 'open') return
    // Never let movement sit in a network queue; the next snapshot recovers its distance.
    if (!reliable && channel.bufferedAmount > 2048) return
    if (reliable && channel.bufferedAmount > 64 * 1024) { onError('입력 연결이 지연됐습니다. 다시 연결해 주세요.'); return }
    if (reliable) state.epoch++
    state.seq++
    try { channel.send(JSON.stringify({ ...state, x: Math.trunc(state.x), y: Math.trunc(state.y), wheelX: Math.trunc(state.wheelX), wheelY: Math.trunc(state.wheelY) })) }
    catch { onError('입력 연결이 종료됐습니다. 다시 연결해 주세요.') }
  }
  return {
    connect(name: string, channel: Channel) { if (name === 'motion') motion = channel; if (name === 'control') control = channel },
    move(x: number, y: number) { delete state.point; state.x += x; state.y += y; pendingMotion = true },
    point(x: number, y: number) { state.point = [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]; pendingMotion = true },
    wheel(x: number, y: number) { state.wheelX += x; state.wheelY += y; pendingMotion = true },
    flushMotion() { if (pendingMotion) { pendingMotion = false; send(false) } },
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

export type StickKind = 'left' | 'wheel' | 'right' | 'pan' | 'zoom'
export const HOLD_MS = 320
export const STICK_TRAVEL = 8
export const stickButton = (kind: StickKind) => kind === 'left' ? 1 : kind === 'wheel' ? 2 : kind === 'right' ? 4 : 0

/** High gain with a fine centre, tiny visible travel; speed independent of display refresh. */
export function stickVelocity(x: number, y: number) {
  const distance = Math.hypot(x, y)
  if (distance < 2) return { x: 0, y: 0 }
  const strength = Math.min(1, (distance - 2) / 18)
  const speed = 2600 * strength * strength
  return { x: x / distance * speed, y: y / distance * speed }
}

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
      if (Math.hypot(dx, dy) >= 3) moved = true
      x = dx; y = dy
    },
    tick(now: number, seconds: number) {
      if (!active) return { x: 0, y: 0, held: false }
      hold(now)
      const vertical = kind === 'zoom' || kind === 'wheel' && !held
      const velocity = stickVelocity(vertical ? 0 : x, y), dt = Math.min(seconds, .04)
      if (moved) {
        if (kind === 'pan') view(velocity.x * dt, velocity.y * dt, 0)
        else if (kind === 'zoom') view(0, 0, -velocity.y * dt / 700)
        else if (kind === 'wheel' && !held) input.wheel(0, velocity.y * dt)
        else input.move(velocity.x * dt, velocity.y * dt)
      }
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
