import { useId, useState } from 'react'
import { HoverTipLayer } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { Undo } from 'iconoir-react'
import { useI18n } from '../i18n'
import { DEFAULT_MEWCAT_SIZE, MAX_MEWCAT_SIZE, MIN_MEWCAT_SIZE, setMewcatSize, useMewcatSize } from '../utils/mewcat-size-preferences'

export function MewcatSizeSettings() {
  const { t } = useI18n()
  const size = useMewcatSize()
  const id = useId()
  const [saveFailed, setSaveFailed] = useState(false)
  const change = (next: number) => setSaveFailed(!setMewcatSize(next))
  return <HoverTipLayer className="mt-3 text-sm">
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="flex-1 font-medium text-ink">{uiText('기본 크기')}</label>
      <output htmlFor={id} className="tabular-nums text-ink-secondary">{size}px</output>
      <button type="button" aria-label={t('common.reset')} data-tip={t('common.reset')} disabled={size === DEFAULT_MEWCAT_SIZE}
        onClick={() => change(DEFAULT_MEWCAT_SIZE)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-25 disabled:hover:bg-transparent">
        <Undo width={18} height={18} aria-hidden="true" />
      </button>
    </div>
    <input id={id} type="range" min={MIN_MEWCAT_SIZE} max={MAX_MEWCAT_SIZE} step={1} value={size} aria-valuetext={`${size}px`}
      onChange={event => change(event.currentTarget.valueAsNumber)} className="h-9 w-full cursor-pointer rounded accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
    {saveFailed && <p role="alert" className="mt-1 text-xs text-danger">{uiText('크기를 저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.')}</p>}
  </HoverTipLayer>
}
