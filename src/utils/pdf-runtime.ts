import { GlobalWorkerOptions, getDocument, version } from 'pdfjs-dist'
import type { InkStroke } from './pdf-geometry'

const assets = `/pdf-assets/${version}/`
GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.mjs`

export function loadPdf(url: string) {
  return getDocument({
    url, cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`, iccUrl: `${assets}iccs/`,
    disableAutoFetch: true, disableStream: true, rangeChunkSize: 256 * 1024,
  })
}

export function exportPdf(bytes: Uint8Array, strokes: InkStroke[], signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-save-worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    worker.onmessage = event => { cleanup(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.bytes) }
    worker.onerror = event => { cleanup(); reject(new Error(event.message)) }
    worker.postMessage({ bytes, strokes }, [bytes.buffer])
  })
}
