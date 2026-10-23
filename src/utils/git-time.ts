import { uiText } from '@mew/ui/i18n-core'
/** Keep the largest elapsed unit; future clock skew is shown as zero minutes. */
export function relativeCommitTime(value: string, now = Date.now()): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '—'
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000))
  if (minutes >= 1440) return uiText("{p0}일 전", { p0: Math.floor(minutes / 1440) })
  if (minutes >= 60) return uiText("{p0}시간 전", { p0: Math.floor(minutes / 60) })
  return uiText("{p0}분 전", { p0: minutes })
}
