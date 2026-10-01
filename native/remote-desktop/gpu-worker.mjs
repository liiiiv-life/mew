import { parentPort } from 'node:worker_threads'
import koffi from 'koffi'
import { windowsGpu } from './gpu-windows.mjs'
import { windowsCursor } from './cursor-windows.mjs'
import { cursorPng } from './cursor-png.mjs'

const gpu = windowsGpu(koffi)
const user = koffi.load('user32.dll'), getDC = user.func('void *GetDC(void *)'), releaseDC = user.func('int ReleaseDC(void *, void *)')
const setPower = koffi.load('kernel32.dll').func('uint32 SetThreadExecutionState(uint32)')
const multimedia = koffi.load('winmm.dll'), beginPeriod = multimedia.func('uint32 timeBeginPeriod(uint32)'), endPeriod = multimedia.func('uint32 timeEndPeriod(uint32)')
let preciseTimer = false
let session, timer, leaseTimer, cursor, dc, waiting = false, lastCursor = '', lastCursorAt = 0, lease = 0
const stop = () => {
  clearTimeout(timer); clearInterval(leaseTimer); timer = undefined; gpu.stop(); cursor = undefined; waiting = false; lastCursor = ''; session = undefined
  if (dc) releaseDC(null, dc); dc = undefined
  if (preciseTimer) endPeriod(1); preciseTimer = false
  setPower(0x80000000)
}
const fail = error => { const id = session; stop(); parentPort.postMessage({ type: 'error', session: id, message: error.message }) }
const poll = () => {
  if (!session || waiting) return
  try {
    const frame = gpu.next()
    if (performance.now() - lastCursorAt >= 33) {
      const value = cursor(), identity = JSON.stringify({ ...value, shape: undefined })
      lastCursorAt = performance.now()
      if (identity !== lastCursor || value.shape) {
        if (value.shape) value.shape = { ...value.shape, pixels: undefined, png: cursorPng(value.shape) }
        parentPort.postMessage({ type: 'cursor', session, value }); lastCursor = identity
      }
    }
    if (frame) {
      const data = new Uint8Array(frame.data); waiting = true
      parentPort.postMessage({ type: 'frame', session, ...frame, data }, [data.buffer])
    } else timer = setTimeout(poll, 2)
  } catch (error) { fail(error) }
}
parentPort.on('message', message => {
  try {
    if (message.type === 'start') {
      stop(); session = message.session
      if (!gpu.screens().some(item => item.id === message.id)) throw new Error('공유할 화면이 바뀌었습니다. 다시 연결해 주세요.')
      const screen = gpu.start(message.id); dc = getDC(null); cursor = windowsCursor(koffi, dc, screen)
      preciseTimer = beginPeriod(1) === 0
      lease = Date.now(); leaseTimer = setInterval(() => { if (Date.now() - lease > 8000) fail(new Error('화면 공유 승인이 만료됐습니다.')) }, 250)
      setPower(0x80000003)
      parentPort.postMessage({ type: 'started', session, screen }); poll()
    } else if (message.type === 'list' && !session) {
      gpu.refresh()
      const screens = gpu.screens()
      if (!screens.length) throw new Error('Windows에 활성 화면이 없습니다. 모니터 없이 사용하려면 서명된 Mew 가상 디스플레이 드라이버를 설치해 주세요.')
      parentPort.postMessage({ type: 'listed', session: message.session, screens })
    } else if (message.type === 'stop' && (!session || message.session === session)) {
      const id = message.session; stop(); parentPort.postMessage({ type: 'stopped', session: id })
    } else if (message.type === 'ack' && message.session === session) { waiting = false; poll() }
    else if (message.type === 'lease' && message.session === session) lease = Date.now()
    else if (message.type === 'keyframe' && message.session === session) gpu.keyframe()
    else if (message.type === 'bitrate' && message.session === session) gpu.bitrate(message.value)
    else if (message.type === 'close') { stop(); gpu.close(); parentPort.close() }
  } catch (error) { fail(error) }
})
parentPort.postMessage({ type: 'ready', screens: gpu.screens() })
