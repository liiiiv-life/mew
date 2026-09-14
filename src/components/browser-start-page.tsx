import { useId, useRef, useState } from 'react'
import { Globe, Plus, Xmark } from 'iconoir-react'
import { useFocusedShortcutScope } from '@mew/shortcuts'
import { useI18n } from '../i18n'
import { normalizeBrowserUrl, type BrowserShortcut } from '../utils/browser-shortcuts'

export function BrowserStartPage({ shortcuts, onChange, onOpen, onClose }: {
  shortcuts: BrowserShortcut[]
  onChange: (next: BrowserShortcut[]) => boolean
  onOpen: (url: string) => Promise<void>
  onClose?: () => void
}) {
  const { t } = useI18n()
  const addressId = useId()
  const scope = useRef<HTMLDivElement>(null)
  useFocusedShortcutScope(scope, { closeTab: () => { if (!onClose) return false; onClose(); return true } })
  const [address, setAddress] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const opening = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const inputClass = 'min-w-0 w-full rounded-md border border-edge-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'
  const open = async (raw: string) => {
    if (opening.current) return
    let target: string
    try { target = normalizeBrowserUrl(raw) } catch { setError(t('browser.invalidAddress')); return }
    opening.current = true; setBusy(true); setError(null)
    try { await onOpen(target) } catch { setError(t('browser.openFailed')) }
    finally { opening.current = false; setBusy(false) }
  }
  const save = (next: BrowserShortcut[]) => {
    if (!onChange(next)) { setError(t('browser.shortcutSaveFailed')); return false }
    setError(null)
    return true
  }
  return <div ref={scope} className="flex min-h-0 flex-1 overflow-y-auto px-6 py-8">
    <div className="m-auto w-full max-w-md space-y-6">
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); void open(address) }}>
        <label htmlFor={addressId} className="text-sm text-ink-secondary">{t('browser.address')}</label>
        <div className="flex gap-2">
          <input id={addressId} value={address} onChange={event => setAddress(event.target.value)} className={inputClass} placeholder={t('browser.addressPlaceholder')} spellCheck={false} inputMode="url" autoComplete="url" disabled={busy} />
          <button type="submit" disabled={busy || !address.trim()} className="shrink-0 rounded-md bg-accent px-3 text-sm text-ink-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">{t(busy ? 'browser.opening' : 'browser.go')}</button>
        </div>
      </form>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-secondary">{t('browser.shortcuts')}</span>
          <button type="button" onClick={() => { setAdding(true); setError(null) }} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"><Plus width={14} height={14} aria-hidden="true" />{t('browser.addShortcut')}</button>
        </div>
        {shortcuts.map(shortcut => <div key={shortcut.id} className="flex items-center gap-1">
          <button type="button" disabled={busy} onClick={() => { void open(shortcut.url) }} className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left text-sm text-ink hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40" title={shortcut.url}>
            <Globe width={18} height={18} className="shrink-0 text-ink-secondary" aria-hidden="true" />
            <span className="min-w-0 truncate">{shortcut.name}</span>
          </button>
          <button type="button" onClick={() => save(shortcuts.filter(item => item.id !== shortcut.id))} aria-label={t('browser.removeShortcut', { name: shortcut.name })} className="rounded p-2 text-ink-muted hover:bg-surface-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"><Xmark width={16} height={16} aria-hidden="true" /></button>
        </div>)}
        {adding && <form className="space-y-3 border-t border-edge pt-3" onSubmit={event => {
          event.preventDefault()
          let target: string
          try { target = normalizeBrowserUrl(url) } catch { setError(t('browser.invalidAddress')); return }
          if (!name.trim()) return
          if (save([...shortcuts, { id: crypto.randomUUID(), name: name.trim(), url: target }])) { setName(''); setUrl(''); setAdding(false) }
        }}>
          <label className="block space-y-1 text-xs text-ink-secondary"><span>{t('browser.shortcutName')}</span><input autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)} className={inputClass} /></label>
          <label className="block space-y-1 text-xs text-ink-secondary"><span>{t('browser.address')}</span><input required value={url} onChange={event => setUrl(event.target.value)} className={inputClass} placeholder="localhost:3000" inputMode="url" spellCheck={false} /></label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setAdding(false); setError(null) }} className="rounded px-3 py-2 text-sm text-ink-secondary hover:bg-surface-raised">{t('common.cancel')}</button>
            <button type="submit" className="rounded bg-accent px-3 py-2 text-sm text-ink-on-accent">{t('common.save')}</button>
          </div>
        </form>}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  </div>
}
