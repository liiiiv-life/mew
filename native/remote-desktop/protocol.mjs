export const INPUT_VERSION = 1
export const INPUT_TIMEOUT = 1500
export const MAX_SIGNAL_BYTES = 128 * 1024
export const INPUT_LIMIT = 4096
export const BUTTONS = [1, 2, 4] // left, middle, right

export function validSnapshot(value) {
  return value?.type === 'input' && value.v === INPUT_VERSION && Number.isSafeInteger(value.seq) && value.seq >= 0
    && Number.isSafeInteger(value.epoch) && value.epoch >= 0
    && ['x', 'y', 'wheelX', 'wheelY'].every((key) => Number.isFinite(value[key]) && Math.abs(value[key]) <= 1e12)
    && Number.isInteger(value.buttons) && value.buttons >= 0 && value.buttons <= 7
    && Array.isArray(value.keys) && value.keys.length <= 16 && value.keys.every((key) => typeof key === 'string' && /^[A-Za-z0-9]{1,24}$/.test(key))
    && (value.point == null || Array.isArray(value.point) && value.point.length === 2 && value.point.every((n) => Number.isFinite(n) && n >= 0 && n <= 1))
}

/** Motion counters recover dropped packets; transitions are repeated over a reliable channel. */
export function createInputReceiver(adapter, now = Date.now) {
  let previous = { seq: -1, epoch: 0, x: 0, y: 0, wheelX: 0, wheelY: 0, buttons: 0, keys: [] }, lastAt = null, pending = null
  let appliedButtons = 0
  const appliedKeys = new Set()
  const clamp = (n) => Math.max(-INPUT_LIMIT, Math.min(INPUT_LIMIT, n))
  function release() {
    for (const bit of BUTTONS) if (appliedButtons & bit) { try { adapter.button(bit, false) } catch { /* Continue releasing the other buttons. */ } }
    for (const key of appliedKeys) { try { adapter.key(key, false) } catch { /* Continue releasing the other keys. */ } }
    appliedButtons = 0; appliedKeys.clear(); pending = null
    previous = { ...previous, buttons: 0, keys: [] }
  }
  function accept(value, reliable = true) {
      if (!validSnapshot(value)) throw new Error('Invalid desktop input')
      // A lossy motion packet must not overtake a reliable down/up pair and erase a click.
      if (!reliable && value.epoch > previous.epoch) { if (!pending || value.seq > pending.seq) pending = value; return }
      if (value.seq <= previous.seq || value.epoch < previous.epoch) return
      if (!reliable && (value.buttons !== previous.buttons || JSON.stringify(value.keys) !== JSON.stringify(previous.keys))) return
      lastAt = now()
      // Restore lost movement at the old button state, then apply transitions at that position.
      if (value.point) {
        if (value.point[0] !== previous.point?.[0] || value.point[1] !== previous.point?.[1] || value.buttons !== previous.buttons || value.wheelX !== previous.wheelX || value.wheelY !== previous.wheelY) adapter.moveTo?.(value.point[0], value.point[1])
      }
      else if (value.x !== previous.x || value.y !== previous.y) adapter.move(clamp(value.x - previous.x), clamp(value.y - previous.y))
      for (const bit of BUTTONS) if ((value.buttons & bit) && !(previous.buttons & bit)) { appliedButtons |= bit; adapter.button(bit, true) }
      if (value.wheelX !== previous.wheelX || value.wheelY !== previous.wheelY) adapter.wheel(clamp(value.wheelX - previous.wheelX), clamp(value.wheelY - previous.wheelY))
      for (const bit of BUTTONS) if (!(value.buttons & bit) && (previous.buttons & bit)) { adapter.button(bit, false); appliedButtons &= ~bit }
      for (const key of previous.keys) if (!value.keys.includes(key)) { adapter.key(key, false); appliedKeys.delete(key) }
      for (const key of value.keys) if (!previous.keys.includes(key)) { appliedKeys.add(key); adapter.key(key, true) }
      previous = { ...value, keys: [...value.keys] }
      if (reliable && pending && pending.epoch <= previous.epoch) { const next = pending; pending = null; accept(next, false) }
  }
  return {
    accept,
    keyChord(keys) {
      const held = [...appliedKeys]
      let failure
      const emit = (code, down) => { try { adapter.key(code, down) } catch (error) { failure ??= error } }
      for (const code of held) emit(code, false)
      if (!failure) for (const code of keys) emit(code, true)
      for (const code of [...keys].reverse()) emit(code, false)
      for (const code of held) emit(code, true)
      if (failure) throw failure
    },
    get sequence() { return previous.seq },
    get point() { return previous.point },
    release,
    pause() { release(); lastAt = null },
    tick() { if (lastAt !== null && now() - lastAt > INPUT_TIMEOUT) { release(); return true }; return false },
  }
}
