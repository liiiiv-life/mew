/// <reference lib="webworker" />
import { annotatePdf } from './pdf-annotations'
import type { InkStroke } from './pdf-geometry'

declare const self: DedicatedWorkerGlobalScope
self.onmessage = async (event: MessageEvent<{ bytes: Uint8Array; strokes: InkStroke[] }>) => {
  try {
    const bytes = await annotatePdf(event.data.bytes, event.data.strokes)
    self.postMessage({ bytes }, [bytes.buffer])
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
