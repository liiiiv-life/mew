import { DocumentGraphLayout } from './document-graph-layout'

type Message = { type: 'init'; count: number; edges: Uint32Array } | { type: 'pin'; index: number; point: [number, number] | null }
const scope = self as unknown as { onmessage: ((event: MessageEvent<Message>) => void) | null; postMessage: (message: unknown, transfer: Transferable[]) => void }
let layout: DocumentGraphLayout | null = null
let scheduled = false
function run() {
  scheduled = false
  if (!layout) return
  const deadline = performance.now() + 10
  let running = layout.step()
  while (running && performance.now() < deadline) running = layout.step()
  const positions = layout.positions.slice()
  scope.postMessage({ positions, settled: !running }, [positions.buffer])
  if (running) { scheduled = true; setTimeout(run, 16) }
}
scope.onmessage = event => {
  const message = event.data
  if (message.type === 'init') layout = new DocumentGraphLayout(message.count, message.edges)
  else layout?.pin(message.index, message.point)
  if (!scheduled) { scheduled = true; setTimeout(run, 0) }
}
