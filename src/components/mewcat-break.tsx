import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { formatBreakCountdown } from '../utils/mewcat-break-rules'
import { saveBreakPreferences, useBreakPreferences } from '../utils/mewcat-break-preferences'
import { mewcatBreakCopy } from './mewcat-break-copy'

export function MewcatBreak({ remainingMs, children }: { remainingMs: number; children: ReactNode }) {
  const layer = useRef<HTMLDivElement>(null)
  const { locale } = useI18n()
  const copy = mewcatBreakCopy[locale]
  useLayoutEffect(() => {
    const element = layer.current!
    // Manual popover escapes other layers without making the workspace inert or moving focus.
    element.showPopover?.()
    return () => { if (element.hidePopover && element.matches(':popover-open')) element.hidePopover() }
  }, [])
  return <div ref={layer} popover="manual" className="mewcat-break" data-mewcat-break>
    {children}
    <div className="mewcat-break-caption">
      <div role="timer" aria-live="off" aria-label={copy.remaining}>{formatBreakCountdown(remainingMs)}</div>
    </div>
  </div>
}

export function MewcatBreakSettings() {
  const preferences = useBreakPreferences()
  const { locale } = useI18n()
  const copy = mewcatBreakCopy[locale]
  const [enabled, setEnabled] = useState(preferences.enabled)
  const [workHours, setWorkHours] = useState(String(Math.floor(preferences.workMinutes / 60)))
  const [workMinutes, setWorkMinutes] = useState(String(preferences.workMinutes % 60))
  const [restHours, setRestHours] = useState(String(Math.floor(preferences.restMinutes / 60)))
  const [restMinutes, setRestMinutes] = useState(String(preferences.restMinutes % 60))
  const [message, setMessage] = useState<'invalid' | 'saved' | null>(null)
  const id = useId()
  useEffect(() => {
    setEnabled(preferences.enabled)
    setWorkHours(String(Math.floor(preferences.workMinutes / 60)))
    setWorkMinutes(String(preferences.workMinutes % 60))
    setRestHours(String(Math.floor(preferences.restMinutes / 60)))
    setRestMinutes(String(preferences.restMinutes % 60))
  }, [preferences])
  const inputClass = 'min-h-10 w-20 rounded border border-edge bg-surface px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent'
  return <section className="mt-6 border-t border-edge pt-4" aria-label={copy.title}>
    <h3 className="text-sm font-medium text-ink">{copy.title}</h3>
    <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{copy.hint}</p>
    <form onChange={() => setMessage(null)} onSubmit={event => {
      event.preventDefault()
      const fields = [workHours, workMinutes, restHours, restMinutes]
      const values = fields.map(value => /^\d+$/.test(value) ? Number(value) : NaN)
      const [wh, wm, rh, rm] = values
      if (values.some((value, index) => !Number.isInteger(value) || value < 0 || value > (index % 2 ? 59 : 23)) || wh * 60 + wm === 0 || rh * 60 + rm === 0) {
        setMessage('invalid')
        return
      }
      saveBreakPreferences({ enabled, workMinutes: wh * 60 + wm, restMinutes: rh * 60 + rm })
      setMessage('saved')
    }}>
      <label className="mt-2 flex min-h-11 cursor-pointer items-center justify-between gap-4 text-sm text-ink">
        {copy.enabled}<input type="checkbox" className="h-4 w-4 accent-accent" checked={enabled} onChange={event => setEnabled(event.target.checked)} />
      </label>
      {([
        { label: copy.work, hours: workHours, minutes: workMinutes, setHours: setWorkHours, setMinutes: setWorkMinutes },
        { label: copy.rest, hours: restHours, minutes: restMinutes, setHours: setRestHours, setMinutes: setRestMinutes },
      ]).map((row, index) => <fieldset key={index} className="mt-3">
        <legend className="mb-2 text-sm text-ink">{row.label}</legend>
        <div className="flex flex-wrap items-center gap-2">
          <input id={`${id}-${index}-hours`} aria-label={`${row.label} ${copy.hours}`} className={inputClass} type="number" inputMode="numeric" min={0} max={23} step={1} required value={row.hours} onChange={event => row.setHours(event.target.value)} />
          <label htmlFor={`${id}-${index}-hours`} className="text-xs text-ink-secondary">{copy.hours}</label>
          <input id={`${id}-${index}-minutes`} aria-label={`${row.label} ${copy.minutes}`} className={inputClass} type="number" inputMode="numeric" min={0} max={59} step={1} required value={row.minutes} onChange={event => row.setMinutes(event.target.value)} />
          <label htmlFor={`${id}-${index}-minutes`} className="text-xs text-ink-secondary">{copy.minutes}</label>
        </div>
      </fieldset>)}
      <p className="mt-3 text-xs leading-relaxed text-ink-secondary">{copy.constraint}</p>
      <button type="submit" className="mt-3 min-h-10 rounded border border-edge px-3 text-sm text-ink hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent">{copy.save}</button>
      {message && <p role={message === 'invalid' ? 'alert' : 'status'} className={`mt-2 text-xs ${message === 'invalid' ? 'text-danger' : 'text-ink-secondary'}`}>{copy[message]}</p>}
    </form>
    <p className="mt-3 text-xs leading-relaxed text-ink-secondary">{copy.scope}</p>
  </section>
}
