import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import { useOverlayDismiss } from './useOverlayDismiss'

type HSV = { h: number; s: number; v: number }
const clamp = (value: number, max = 100) => Math.max(0, Math.min(max, value))
const validHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value)

function fromHex(hex: string, previous: HSV): HSV {
  const [r, g, b] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  const hue = delta === 0 ? previous.h : 60 * (max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4)
  // Gray has no hue, and black has no saturation: retain these while editing.
  return { h: hue, s: max === 0 ? previous.s : delta / max * 100, v: max * 100 }
}

function toHex({ h, s, v }: HSV): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return Math.round(255 * v / 100 * (1 - s / 100 * Math.max(0, Math.min(k, 4 - k, 1)))).toString(16).padStart(2, '0')
  }
  return `#${f(5)}${f(3)}${f(1)}`
}

export interface ColorPickerProps {
  /** Controlled, opaque #RRGGBB color. Persistence belongs to the caller. */
  value: string
  onChange: (value: string) => void
  defaultValue: string
  disabled?: boolean
  labels: { color: string; hex: string; hue: string; saturation: string; brightness: string; reset: string; close: string }
}

/** Inline app-owned picker; never opens an OS color dialog. */
export function ColorPicker({ value, onChange, defaultValue, disabled = false, labels }: ColorPickerProps) {
  const id = useId(), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const color = validHex(value) ? value.toLowerCase() : '#000000'
  const [draft, setDraft] = useState(color), [open, setOpen] = useState(false), [editing, setEditing] = useState(false)
  const [hsv, setHsv] = useState(() => fromHex(color, { h: 0, s: 0, v: 0 }))
  const lastEmitted = useRef<string | null>(null)
  const close = () => { setOpen(false); setDraft(color); trigger.current?.focus({ preventScroll: true }) }
  useOverlayDismiss((open || editing) && !disabled && close, { outside: () => root.current })
  useEffect(() => {
    setDraft(color)
    if (lastEmitted.current !== color) setHsv(previous => fromHex(color, previous))
    lastEmitted.current = null
  }, [color])
  useEffect(() => { if (disabled) { setOpen(false); setEditing(false) } }, [disabled])

  function update(next: HSV) {
    if (disabled) return
    setHsv(next)
    const hex = toHex(next)
    lastEmitted.current = hex
    setDraft(hex)
    if (hex !== color) onChange(hex)
  }
  function changeHex(next: string) {
    setDraft(next)
    if (!validHex(next)) return
    const hex = next.toLowerCase()
    setHsv(previous => fromHex(hex, previous))
    onChange(hex)
  }
  function point(event: PointerEvent<HTMLDivElement>) {
    if (disabled) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    update({ ...hsv, s: clamp((event.clientX - rect.left) / rect.width * 100), v: clamp(100 - (event.clientY - rect.top) / rect.height * 100) })
  }

  return <div ref={root} className="min-w-0" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); setDraft(color) }
  }}>
    <label htmlFor={`${id}-hex`} className="text-sm font-medium">{labels.color}</label>
    <div className="mt-2 flex min-w-0 items-center gap-2">
      <button ref={trigger} type="button" aria-label={labels.color} aria-expanded={open && !disabled} aria-controls={open ? `${id}-panel` : undefined}
        disabled={disabled} onClick={() => open ? close() : setOpen(true)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-edge-strong bg-surface hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
        <span className="h-7 w-7 rounded border border-edge-bright" style={{ backgroundColor: color }} />
      </button>
      <input id={`${id}-hex`} type="text" value={draft} disabled={disabled} aria-label={labels.hex}
        onChange={event => changeHex(event.target.value)} onFocus={() => setEditing(true)} onBlur={() => { setEditing(false); setDraft(color) }}
        className="h-11 min-w-0 flex-1 rounded border border-edge-strong bg-surface px-3 font-mono text-sm text-ink outline-none focus:border-accent disabled:opacity-40"
        placeholder="#RRGGBB" maxLength={7} autoComplete="off" autoCapitalize="off" spellCheck={false} />
      <button type="button" onClick={() => changeHex(defaultValue)} disabled={disabled || (color === defaultValue && draft === defaultValue)}
        className="h-11 shrink-0 rounded border border-edge-strong px-2 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">{labels.reset}</button>
    </div>
    {open && !disabled && <div id={`${id}-panel`} role="group" aria-label={labels.color} className="mt-2 rounded border border-edge-strong bg-surface p-3">
      <div className="relative h-36 touch-none select-none overflow-hidden rounded" aria-hidden="true"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          point(event)
        }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) point(event) }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { point(event); event.currentTarget.releasePointerCapture(event.pointerId) } }}>
        <span className="pointer-events-none absolute h-3 w-3 rounded-full border-2 border-white ring-1 ring-black"
          style={{ left: `clamp(6px, ${hsv.s}%, calc(100% - 6px))`, top: `clamp(6px, ${100 - hsv.v}%, calc(100% - 6px))`, transform: 'translate(-50%, -50%)' }} />
      </div>
      <div className="mt-2 flex flex-col">
        {([
          { key: 'h', label: labels.hue, max: 360, unit: '°', background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' },
          { key: 's', label: labels.saturation, max: 100, unit: '%', background: `linear-gradient(to right, ${toHex({ ...hsv, s: 0 })}, ${toHex({ ...hsv, s: 100 })})` },
          { key: 'v', label: labels.brightness, max: 100, unit: '%', background: `linear-gradient(to right, #000, ${toHex({ ...hsv, v: 100 })})` },
        ] as const).map(({ key, label, max, unit, background }) => <label key={key} className="flex min-h-11 items-center gap-2 text-xs text-ink-secondary">
          <span className="w-16 shrink-0">{label}</span>
          <span className="relative flex h-11 min-w-0 flex-1 items-center">
            <span className="pointer-events-none absolute inset-x-0 h-3 rounded-full" style={{ background }} />
            <input type="range" min={0} max={max} step={1} value={hsv[key]} aria-label={label} aria-valuetext={`${Math.round(hsv[key])}${unit}`}
              onChange={event => update({ ...hsv, [key]: Number(event.target.value) })}
              className="relative h-11 w-full cursor-pointer appearance-none rounded bg-transparent focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-black [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-black" />
          </span>
          <span className="w-9 shrink-0 text-right tabular-nums">{Math.round(hsv[key])}{unit}</span>
        </label>)}
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={close} className="min-h-11 rounded px-3 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent">{labels.close}</button>
      </div>
    </div>}
  </div>
}
