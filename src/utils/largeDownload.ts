/** 브라우저가 연결 종류를 명시했을 때만 셀룰러로 판단한다. 추측해서 경고하지 않는다. */
export function isMobileCellularConnection(): boolean {
  if (!window.matchMedia('(max-width: 767px)').matches) return false
  const connection = (navigator as Navigator & { connection?: { type?: string } }).connection
  return connection?.type === 'cellular'
}

/** 응답이 파일 크기를 알리지 않거나 HEAD가 실패하면 경고할 근거가 없으므로 null을 돌려준다. */
export async function downloadSize(url: string): Promise<number | null> {
  const response = await fetch(url, { method: 'HEAD' })
  if (!response.ok) return null
  const size = Number(response.headers.get('content-length'))
  return Number.isFinite(size) && size >= 0 ? size : null
}

export const LARGE_DOWNLOAD_BYTES = 100 * 1024 * 1024

export function isLargeDownload(bytes: number): boolean {
  return bytes > LARGE_DOWNLOAD_BYTES
}

export function formatDownloadSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
