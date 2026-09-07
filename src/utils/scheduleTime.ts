/** 현재 분 자체는 이미 흐르고 있으므로 예약 가능한 최솟값은 바로 다음 로컬 분이다. */
export function nextLocalMinuteValue(now: number): string {
  const next = new Date(Math.floor(now / 60_000) * 60_000 + 60_000)
  const year = next.getFullYear()
  const month = String(next.getMonth() + 1).padStart(2, '0')
  const day = String(next.getDate()).padStart(2, '0')
  const hour = String(next.getHours()).padStart(2, '0')
  const minute = String(next.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}
