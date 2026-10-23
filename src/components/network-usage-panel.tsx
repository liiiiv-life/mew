import { useId, useSyncExternalStore } from 'react'
import { useUiLocale } from '@mew/ui/i18n'
import { uiText } from '@mew/ui/i18n-core'
import { ArrowDown, ArrowUp } from 'iconoir-react'
import { networkUsage } from '../utils/network-usage.ts'
import { formatDesktopBytes } from '../utils/desktop-network.ts'

const formatBytes = (bytes: number) => formatDesktopBytes(bytes).replace(/^(\d+) /, '$1.0 ')

export function NetworkUsagePanel() {
  useUiLocale()
  const usage = useSyncExternalStore(networkUsage.subscribe, networkUsage.getSnapshot)
  const titleId = useId()
  const received = usage.desktop.received + usage.other.received, sent = usage.desktop.sent + usage.other.sent
  const rate = { received: usage.rate.desktop.received + usage.rate.other.received, sent: usage.rate.desktop.sent + usage.rate.other.sent }
  const sections = [
    { name: uiText('누적 사용량'), values: { desktop: usage.desktop, other: usage.other, total: { received, sent } }, speed: false },
    { name: uiText('네트워크 속도'), values: { ...usage.rate, total: rate }, speed: true },
  ]
  return <section aria-labelledby={titleId} className="mt-4 border-t border-edge pt-3">
    <h3 id={titleId} className="mb-2 text-sm font-medium text-ink">{uiText('네트워크 사용량')}</h3>
    {sections.map(section => {
      const format = (bytes: number) => `${formatBytes(bytes)}${section.speed ? '/s' : ''}`
      return <table key={section.name} className="mb-2 w-full text-xs tabular-nums">
        <caption className="py-1 text-left font-medium text-ink">{section.name}</caption>
        <thead><tr className="border-b border-edge text-ink-secondary">
          <th scope="col" className="py-2 text-left font-normal">{uiText('구분')}</th>
          <th scope="col" className="py-2 pl-2 text-right font-normal"><span className="inline-flex items-center gap-1"><ArrowUp width={12} height={12} aria-hidden="true" />{uiText('업로드')}</span></th>
          <th scope="col" className="py-2 pl-2 text-right font-normal"><span className="inline-flex items-center gap-1"><ArrowDown width={12} height={12} aria-hidden="true" />{uiText('다운로드')}</span></th>
        </tr></thead>
        <tbody>{([['desktop', uiText('원격 데스크톱')], ['other', uiText('그 외')], ['total', uiText('전체')]] as const).map(([key, name]) => <tr key={key} className={key === 'total' ? 'border-t border-edge font-medium text-ink' : 'text-ink-secondary'}>
          <th scope="row" className="py-2 text-left font-normal">{name}</th>
          <td className="whitespace-nowrap py-2 pl-2 text-right">{format(section.values[key].sent)}</td>
          <td className="whitespace-nowrap py-2 pl-2 text-right">{format(section.values[key].received)}</td>
        </tr>)}</tbody>
      </table>
    })}
    <p className="mt-2 text-[11px] leading-5 text-ink-secondary">{uiText('현재 탭을 연 이후의 추정치입니다. 새로고침하면 초기화됩니다.')}</p>
  </section>
}
