import { parentPort, workerData } from 'node:worker_threads'
import koffi from 'koffi'
import { windowsCapture } from './capture-windows.mjs'
import { gdiCapture } from './capture-gdi.mjs'
import { macCapture } from './capture-macos.mjs'
let capture
try {
  const backends = { dxgi: windowsCapture, gdi: gdiCapture, macos: macCapture }
  if (!Object.hasOwn(backends, workerData.backend)) throw new Error('Unknown capture backend')
  capture = backends[workerData.backend](koffi, workerData.bounds)
  parentPort.postMessage({ ready: true, width: capture.width, height: capture.height })
  parentPort.on('message', message => {
    if (message?.type === 'close') { capture.close(); parentPort.close(); return }
    try {
      const result = capture.next()
      parentPort.postMessage(result, result.pixels ? [result.pixels.buffer] : [])
    } catch (error) { capture.close(); parentPort.postMessage({ error: error.message }); parentPort.close() }
  })
} catch (error) { capture?.close(); parentPort.postMessage({ error: error.message }); parentPort.close() }
