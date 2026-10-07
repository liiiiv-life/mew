import { useCallback, useId, useState, useSyncExternalStore } from 'react'
import { DialogFrame, HoverTipLayer } from '@mew/ui'
import { useUiLocale } from '@mew/ui/i18n'
import { uiText } from '@mew/ui/i18n-core'
import { Xmark } from 'iconoir-react'
import { networkUsage } from '../utils/network-usage.ts'
import { formatDesktopBytes } from '../utils/desktop-network.ts'

export function NetworkUsageButton() {
  useUiLocale()
  const usage = useSyncExternalStore(networkUsage.subscribe, networkUsage.getSnapshot)
  const [open, setOpen] = useState(false), titleId = useId()
  const close = useCallback(() => setOpen(false), [])
  const received = usage.desktop.received + usage.other.received, sent = usage.desktop.sent + usage.other.sent
  const rows = [
    { name: uiText('원격 데스크톱'), value: usage.desktop },
    { name: uiText('그 외'), value: usage.other },
    { name: uiText('전체'), value: { received, sent } },
  ]
  return <>
    <HoverTipLayer className="contents" placement="bottom">
      <button type="button" onClick={() => setOpen(true)} aria-label={uiText('네트워크 사용량 {total}', { total: formatDesktopBytes(received + sent) })}
        data-tip={uiText('네트워크 사용량')} aria-haspopup="dialog" aria-expanded={open}
        className="h-8 shrink-0 rounded px-1 text-[11px] tabular-nums text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:h-9 md:px-2 md:text-xs">
        {formatDesktopBytes(received + sent)}
      </button>
    </HoverTipLayer>
    {open && <DialogFrame labelledBy={titleId} onClose={close} className="max-w-md max-h-[85dvh] flex flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <h2 id={titleId} className="min-w-0 flex-1 text-sm font-medium text-ink">{uiText('네트워크 사용량')}</h2>
        <button type="button" data-dialog-autofocus aria-label={uiText('닫기')} onClick={close}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
          <Xmark width={16} height={16} aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 overflow-y-auto px-3 py-2">
        <table className="w-full text-xs tabular-nums">
          <thead><tr className="border-b border-edge text-ink-secondary">
            <th scope="col" className="py-2 text-left font-normal">{uiText('구분')}</th>
            {[uiText('수신'), uiText('송신'), uiText('합계')].map(label => <th key={label} scope="col" className="py-2 pl-2 text-right font-normal">{label}</th>)}
          </tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.name} className={index === 2 ? 'border-t border-edge font-medium text-ink' : 'text-ink-secondary'}>
            <th scope="row" className="py-2 text-left font-normal">{row.name}</th>
            <td className="whitespace-nowrap py-2 pl-2 text-right">{formatDesktopBytes(row.value.received)}</td>
            <td className="whitespace-nowrap py-2 pl-2 text-right">{formatDesktopBytes(row.value.sent)}</td>
            <td className="whitespace-nowrap py-2 pl-2 text-right">{formatDesktopBytes(row.value.received + row.value.sent)}</td>
          </tr>)}</tbody>
        </table>
        <p className="mt-2 text-[11px] leading-5 text-ink-secondary">{uiText('현재 탭을 연 이후의 추정치입니다. 새로고침하면 초기화됩니다.')}</p>
      </div>
    </DialogFrame>}
  </>
}
