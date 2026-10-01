import { parentPort } from 'node:worker_threads'
import koffi from 'koffi'
import { posixGpu } from './gpu-posix.mjs'

const gpu = posixGpu(koffi)
let session, timer, deadline, waiting = false, lease = 0
const stop = () => { clearTimeout(timer); clearInterval(deadline); gpu.stop(); session = undefined; waiting = false }
const fail = error => { const id = session; try { stop() } catch { /* Parent retires a capture that could not confirm stop. */ }; parentPort.postMessage({ type: 'error', session: id, message: error.message }) }
const poll = () => {
  if (!session || waiting) return
  try {
    const frame = gpu.next()
    if (!frame) { timer = setTimeout(poll, 2); return }
    const data = new Uint8Array(frame.data); waiting = true
    parentPort.postMessage({ type: 'frame', session, ...frame, data }, [data.buffer])
  } catch (error) { fail(error) }
}
parentPort.on('message', message => {
  try {
    if (message.type === 'start') {
      stop(); session = message.session
      const screen = gpu.start(message.id, 6_000_000, message.source)
      lease = Date.now(); deadline = setInterval(() => { if (Date.now() - lease > 8000) fail(new Error('화면 공유 승인이 만료됐습니다.')) }, 250)
      parentPort.postMessage({ type: 'started', session, screen }); poll()
    } else if (message.type === 'list' && !session) {
      const screens = gpu.screens()
      if (!screens.length) throw new Error('공유할 데스크톱 화면이 없습니다.')
      parentPort.postMessage({ type: 'listed', session: message.session, screens })
    } else if (message.type === 'stop' && (!session || message.session === session)) {
      stop(); parentPort.postMessage({ type: 'stopped', session: message.session })
    } else if (message.type === 'ack' && session === message.session) { waiting = false; poll() }
    else if (message.type === 'lease' && session === message.session) lease = Date.now()
    else if (message.type === 'keyframe' && session === message.session) gpu.keyframe()
    else if (message.type === 'bitrate' && session === message.session) gpu.bitrate(message.value)
    else if (message.type === 'close') { stop(); gpu.close(); parentPort.close() }
  } catch (error) { fail(error) }
})
// Warm only the library/device; no capture, encoder or polling before approval.
parentPort.postMessage({ type: 'ready', screens: [] })
