import { activeRemoteTransport } from './remote-transport.ts'
export async function enableRemoteResources() {
  if (!('serviceWorker' in navigator)) throw new Error('이 브라우저는 원격 파일 미리보기를 지원하지 않습니다.')
  const onMessage = (event: MessageEvent) => {
    if (event.data?.type !== 'mew-resource' || !event.ports[0] || event.source !== navigator.serviceWorker.controller) return
    const transport = activeRemoteTransport(), port = event.ports[0], abort = new AbortController()
    if (!transport) { port.postMessage({ type: 'error' }); port.close(); return }
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reading = false
    const close = () => { abort.abort(); void reader?.cancel().catch(() => {}); port.close() }
    port.onmessage = ({ data }) => {
      if (data.type === 'cancel') { close(); return }
      if (data.type !== 'pull' || reading || !reader) return
      reading = true
      void reader.read().then(result => { if (result.done) { port.postMessage({ type: 'end' }); close() } else { const bytes = result.value.slice().buffer; port.postMessage({ type: 'chunk', bytes }, [bytes]) } }).catch(() => { port.postMessage({ type: 'error' }); close() }).finally(() => { reading = false })
    }
    void transport.fetch(event.data.path, { method: event.data.method, headers: event.data.headers, signal: abort.signal }).then(response => {
      reader = response.body?.getReader()
      port.postMessage({ type: 'response', status: response.status, headers: [...response.headers] })
      if (!reader) { port.postMessage({ type: 'end' }); close() }
    }).catch(() => { port.postMessage({ type: 'error' }); close() })
  }
  navigator.serviceWorker.addEventListener('message', onMessage)
  try {
    await navigator.serviceWorker.register('/remote-resource-worker.js', { scope: '/' })
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); reject(new Error('파일 미리보기를 준비하지 못했습니다.')) }, 5000)
      const changed = () => { if (navigator.serviceWorker.controller) { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve() } }
      navigator.serviceWorker.addEventListener('controllerchange', changed)
    })
  } catch (error) { navigator.serviceWorker.removeEventListener('message', onMessage); throw error }
  return () => navigator.serviceWorker.removeEventListener('message', onMessage)
}
