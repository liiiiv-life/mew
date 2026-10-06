import { HoverTipLayer } from '@mew/ui'
import { ArrowLeft, ArrowRight, Undo } from 'iconoir-react'
import { useI18n } from '../i18n'
import { resetDockPreferences, setDockOrder, setDockPanelVisible, useDockPreferences } from '../hooks/use-dock-preferences'
import { MOBILE_DOCK_ORDER, moveDockPanel, visibleDockPanels, type MobileDockPanel } from '../utils/mobile-dock'
import { dockIcons, useDockLabel } from './dock-items'

const defaultAvailable = MOBILE_DOCK_ORDER.filter(id => id !== 'browser' && id !== 'desktop')
const actionClass = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-25 disabled:hover:bg-transparent'

export function DockSettingsPanel({ available = defaultAvailable }: { available?: readonly MobileDockPanel[] }) {
  const { t } = useI18n()
  const labelFor = useDockLabel()
  const { order, hidden } = useDockPreferences()
  const items = order.filter(id => available.includes(id))
  const visible = visibleDockPanels(order, available, hidden)
  const customized = hidden.length > 0 || order.some((id, index) => id !== MOBILE_DOCK_ORDER[index])
  return <div data-dock-settings><HoverTipLayer className="flex flex-col gap-4">
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-ink-secondary">{t('dock.preview')}</h3>
        <button type="button" className={actionClass} disabled={!customized} aria-label={t('common.reset')} data-tip={t('common.reset')} onClick={resetDockPreferences}><Undo width={18} height={18} aria-hidden="true" /></button>
      </div>
      <div className="flex min-h-16 items-center justify-center rounded-lg bg-surface-raised px-2 py-3">
        {visible.length ? <div className="flex flex-wrap justify-center gap-1" aria-label={t('dock.preview')}>
          {visible.map(id => { const Icon = dockIcons[id]; return <span key={id} data-dock-preview={id} data-tip={labelFor(id)} className="flex h-10 w-10 items-center justify-center rounded-md bg-surface text-ink"><Icon width={22} height={22} strokeWidth={1.7} aria-hidden="true" /><span className="sr-only">{labelFor(id)}</span></span> })}
        </div> : <p className="text-sm text-ink-secondary" role="status">{t('dock.empty')}</p>}
      </div>
    </div>
    <div>
      <h3 className="mb-2 text-xs font-medium text-ink-secondary">{t('dock.items')}</h3>
      <div className="divide-y divide-edge">
        {items.map((id, index) => {
          const Icon = dockIcons[id], label = labelFor(id), enabled = !hidden.includes(id)
          return <div key={id} data-dock-setting={id} className="flex min-h-13 items-center gap-1 py-1">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md py-2 pr-2 has-focus-visible:outline-2 has-focus-visible:outline-accent">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${enabled ? 'bg-accent/10 text-accent' : 'bg-surface-raised text-ink-muted'}`}><Icon width={20} height={20} strokeWidth={1.7} aria-hidden="true" /></span>
              <span className={`min-w-0 flex-1 text-sm ${enabled ? 'text-ink' : 'text-ink-secondary'}`}>{label}</span>
              <input type="checkbox" role="switch" aria-label={label} checked={enabled} onChange={event => setDockPanelVisible(id, event.target.checked)} className="dock-setting-switch shrink-0" />
            </label>
            <button type="button" className={actionClass} disabled={index === 0} aria-label={t('dock.moveLeft', { name: label })} data-tip={t('dock.moveLeft', { name: label })} onClick={() => setDockOrder(moveDockPanel(order, id, items[index - 1]))}><ArrowLeft width={16} height={16} aria-hidden="true" /></button>
            <button type="button" className={actionClass} disabled={index === items.length - 1} aria-label={t('dock.moveRight', { name: label })} data-tip={t('dock.moveRight', { name: label })} onClick={() => setDockOrder(moveDockPanel(order, id, items[index + 1]))}><ArrowRight width={16} height={16} aria-hidden="true" /></button>
          </div>
        })}
      </div>
    </div>
  </HoverTipLayer></div>
}
