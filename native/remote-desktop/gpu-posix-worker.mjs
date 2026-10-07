import { parentPort } from 'node:worker_threads'
import koffi from 'koffi'
import { posixGpu } from './gpu-posix.mjs'

const gpu = posixGpu(koffi)
let session, timer, deadline, negotiation, mode, waiting = false, lease = 0
const stop = () => { clearTimeout(timer); clearInterval(deadline); gpu.stop(); session = undefined; waiting = false }
const fail = error => { const id = session; try { stop() } catch { /* Parent retires a capture that could not confirm stop. */ }; parentPort.postMessage({ type: 'error', session: id, message: error.message }) }
const poll = () => {
  if (!session || waiting) return
  try {
    const frame = gpu.next()
    if (!frame) { timer = setTimeout(poll, mode?.fps >= 120 ? 1 : 2); return }
    const data = frame.data; waiting = true
    parentPort.postMessage({ type: 'frame', session, negotiation, ...frame, data }, [data.buffer])
  } catch (error) { fail(error) }
}
parentPort.on('message', message => {
  try {
    if (message.type === 'start') {
      stop(); session = message.session
      negotiation = message.negotiation
      let screen, error
      const begun = Date.now()
      for (const candidate of message.modes) {
        if (Date.now() - begun > 2000) break
        try { screen = gpu.start(message.id, candidate.bitrate, message.source, candidate); mode = candidate; break } catch (failure) { error = failure; gpu.stop() }
      }
      if (!screen) throw error ?? new Error('지원하는 영상 설정이 없습니다.')
      lease = Date.now(); deadline = setInterval(() => { if (Date.now() - lease > 8000) fail(new Error('화면 공유 승인이 만료됐습니다.')) }, 250)
      parentPort.postMessage({ type: 'started', session, negotiation, screen, video: mode }); poll()
    } else if (message.type === 'list' && !session) {
      const screens = gpu.screens()
      if (!screens.length) throw new Error('공유할 데스크톱 화면이 없습니다.')
      parentPort.postMessage({ type: 'listed', session: message.session, screens })
    } else if (message.type === 'stop' && (!session || message.session === session)) {
      stop(); parentPort.postMessage({ type: 'stopped', session: message.session })
    } else if (message.type === 'ack' && session === message.session && message.negotiation === negotiation) { waiting = false; poll() }
    else if (message.type === 'lease' && session === message.session) lease = Date.now()
    else if (message.type === 'keyframe' && session === message.session) gpu.keyframe()
    else if (message.type === 'bitrate' && session === message.session) gpu.bitrate(message.value)
    else if (message.type === 'close') { stop(); gpu.close(); parentPort.close() }
  } catch (error) { fail(error) }
})
// Warm only the library/device; no capture, encoder or polling before approval.
parentPort.postMessage({ type: 'ready', screens: [] })
