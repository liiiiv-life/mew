import { Refresh } from 'iconoir-react'
import { HoverTipLayer } from '@mew/ui'
import { getAppRuntime } from './app-runtime.ts'
import { useI18n } from '../i18n.tsx'

export function RuntimeControls() {
  const { t } = useI18n()
  const controls = getAppRuntime().controls
  if (!controls) return null
  const resetLabel = `${controls.label} ${t('common.reset')}`
  return <div className="flex shrink-0 items-center gap-1 text-xs text-ink-secondary" data-runtime-controls>
    <span>{controls.label}</span>
    <HoverTipLayer placement="bottom">
      <button type="button" aria-label={resetLabel} data-tip={resetLabel} onClick={controls.reset}
        className="flex h-7 w-7 items-center justify-center rounded hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
        <Refresh width={14} height={14} aria-hidden="true" />
      </button>
    </HoverTipLayer>
  </div>
}
