type HostStatus = { ready: boolean; installable?: boolean; message?: string }
type Job = { state: string; exitCode: number | null }

/** Installation outlives this viewer; polling and connection attempts do not. */
export async function prepareDesktop({ signal, message, installable, request = fetch, pause = wait }: {
  signal: AbortSignal; message: (value: string) => void; installable: (value: boolean) => void
  request?: typeof fetch; pause?: typeof wait
}) {
  const json = async (url: string, method = 'GET') => {
    signal.throwIfAborted()
    const response = await request(`/api/remote-desktop/${url}`, { method, signal, cache: 'no-store' })
    if (!response.ok) throw new Error(response.status === 403 || response.status === 401 ? '소유자 또는 관리자 로그인이 필요합니다.' : '원격 데스크톱 준비 상태를 확인하지 못했습니다. 다시 시도해 주세요.')
    const value = await response.json()
    signal.throwIfAborted()
    return value
  }
  const status: HostStatus = await json('status')
  installable(status.installable === true)
  if (status.ready) return
  if (!status.installable) throw new Error(status.message || '서버 데스크톱을 사용할 수 없습니다.')
  message('원격 데스크톱을 준비하고 있습니다. 처음에는 다운로드에 몇 분 걸릴 수 있습니다.')
  let job: Job = await json('install', 'POST')
  const deadline = Date.now() + 20 * 60_000
  let interval = 250
  while (job.state === 'running') {
    if (Date.now() > deadline) throw new Error('준비가 오래 걸리고 있습니다. 준비 내역에서 진행 상태를 확인해 주세요.')
    await pause(interval, signal)
    job = await json('install')
    interval = Math.min(1500, interval * 2)
  }
  if (job.state !== 'succeeded') throw new Error(job.state === 'interrupted' ? '준비가 중단됐습니다. 다시 연결하면 준비를 재시도합니다.' : '원격 데스크톱 준비에 실패했습니다. 준비 내역에서 오류를 확인한 뒤 다시 연결해 주세요.')
  const ready: HostStatus = await json('status')
  if (!ready.ready) throw new Error(ready.message || '준비한 파일을 확인하지 못했습니다. 다시 연결해 주세요.')
  installable(false)
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
