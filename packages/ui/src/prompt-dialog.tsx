import { useId, useState } from 'react'
import { DialogFrame } from './dialog-frame'
import type { PromptOptions } from './use-dialog'

export function PromptDialog({ options, onDone }: { options: PromptOptions; onDone: (value: string | null) => void }) {
  const id = useId()
  const [value, setValue] = useState(options.defaultValue ?? '')
  return <DialogFrame labelledBy={id} describedBy={options.detail ? `${id}-detail` : undefined} onClose={() => onDone(null)}>
    <form className="p-5 sm:p-6" noValidate onSubmit={(event) => { event.preventDefault(); if (value.trim()) onDone(value.trim()) }}>
      <h2 id={id} className="text-base font-semibold text-ink-bright">{options.message}</h2>
      {options.detail && <p id={`${id}-detail`} className="mt-2 whitespace-pre-wrap break-words text-sm text-ink-secondary">{options.detail}</p>}
      <label className="mt-5 block text-xs font-medium text-ink-secondary" htmlFor={`${id}-input`}>{options.label ?? options.message}</label>
      <input id={`${id}-input`} data-dialog-autofocus value={value} onChange={(event) => setValue(event.target.value)} onFocus={(event) => event.target.select()} autoComplete="off" spellCheck={false} className="mt-2 min-h-11 w-full rounded-lg border border-edge-strong bg-surface-deep px-3 text-sm text-ink" />
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="min-h-10 rounded-lg px-4 text-sm text-ink-secondary hover:bg-surface-hover" onClick={() => onDone(null)}>{options.cancelLabel ?? '취소'}</button>
        <button type="submit" disabled={!value.trim()} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40">{options.confirmLabel ?? '확인'}</button>
      </div>
    </form>
  </DialogFrame>
}

