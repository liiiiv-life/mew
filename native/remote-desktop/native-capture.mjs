import { Worker } from 'node:worker_threads'

/** Only one raw frame may be requested at a time. Worker never controls input. */
export async function nativeCapture(bounds, backend = 'dxgi') {
  const worker = new Worker(new URL('./capture-worker.mjs', import.meta.url), { workerData: { bounds, backend } })
  let pending, closed = false
  const request = (start = false) => new Promise((resolve, reject) => {
    if (closed || pending) { reject(new Error('Capture request unavailable')); return }
    const timer = setTimeout(() => { pending = null; reject(new Error('Capture worker timed out')); void close() }, 3000)
    pending = { resolve: result => { clearTimeout(timer); resolve(result) }, reject: error => { clearTimeout(timer); reject(error) } }
    if (!start) worker.postMessage({ type: 'frame' })
  })
  let closing
  const close = () => {
    if (closing) return closing
    if (closed) return Promise.resolve()
    closed = true; pending?.reject(new Error('Capture closed')); pending = null
    // Give the owning thread time to release COM resources and its wake lock.
    // Termination remains a bound for a stuck driver or failed initialization.
    closing = new Promise(resolve => {
      const timer = setTimeout(() => { void worker.terminate() }, 1000)
      worker.once('exit', () => { clearTimeout(timer); resolve() })
      worker.postMessage({ type: 'close' })
    })
    return closing
  }
  worker.on('message', result => {
    const current = pending; pending = null
    if (result.error) { current?.reject(new Error(result.error)); void close() }
    else current?.resolve(result)
  })
  worker.on('error', error => { pending?.reject(error); pending = null; void close() })
  worker.on('exit', () => { pending?.reject(new Error('Capture worker exited')); pending = null; closed = true })
  try { const info = await request(true); return { ...info, next: () => request(), close } }
  catch (error) { await close(); throw error }
}
