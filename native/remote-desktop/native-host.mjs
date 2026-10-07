import { Worker } from 'node:worker_threads'
import { parentChannel } from './parent-channel.mjs'
import { createInputReceiver, MAX_SIGNAL_BYTES } from './protocol.mjs'
import { nativeDirect } from './native-direct.mjs'
import { nativePlatform } from './native-platform.mjs'
import { validCursor } from './cursor-protocol.mjs'
import { shutdownNativeHost } from './host-shutdown.mjs'
import koffi from 'koffi'
import rtc from 'node-datachannel'

const parent = parentChannel()
const platform = await nativePlatform(koffi)
const worker = new Worker(new URL(process.platform === 'win32' ? './gpu-worker.mjs' : './gpu-posix-worker.mjs', import.meta.url))
let screens, session, listing, shutting = false, stopping, ready = false, pending = '', lease = Date.now(), queue = Promise.resolve()
const emit = (value, id = session?.id) => {
  if (parent.output.destroyed || parent.output.writableLength > MAX_SIGNAL_BYTES * 2) return void shutdown()
  parent.output.write(`MEW_DESKTOP ${JSON.stringify({ ...value, ...(id ? { session: id } : {}) })}\n`)
}
const stop = () => {
  if (stopping) return stopping.promise
  if (!session) return Promise.resolve()
  const old = session; session = undefined
  if (listing) { listing.reject(new Error('화면 선택이 취소됐습니다.')); listing = undefined }
  old.abort?.abort()
  old.networkClosed = Promise.resolve(old.direct?.close()).catch(() => {})
  try { old.receiver?.release() } catch { /* Continue capture cleanup. */ }
  let resolve
  const promise = new Promise(done => { resolve = done })
  stopping = { id: old.id, resolve, promise, old }
  worker.postMessage({ type: 'stop', session: old.id })
  return promise
}
const fail = error => { if (session) emit({ type: 'error', message: error.message }); void stop() }
async function shutdown() {
  if (shutting) return
  shutting = true; clearInterval(watchdog)
  await shutdownNativeHost({ stop, worker, platform, parent, rtc })
}
const watchdog = setInterval(() => {
  if (Date.now() - lease > 8000) return void shutdown()
  try {
    if (session) { platform.pump?.(); session.adapter?.check?.(); if (session.receiver && !platform.allowed()) throw new Error('데스크톱이 잠겼거나 제어 권한이 종료됐습니다.') }
    if (session?.receiver?.tick()) fail(new Error('원격 입력 응답이 종료됐습니다.'))
  } catch (error) { fail(error) }
}, 250)
worker.on('message', value => {
  if (value.type === 'ready') { ready = true; screens = value.screens; emit({ type: 'ready' }, null); return }
  if (value.type === 'stopped' && value.session === stopping?.id) {
    const pending = stopping
    void Promise.resolve().then(() => Promise.all([pending.old.preparing?.catch(() => {}), pending.old.networkClosed])).then(() => pending.old.adapter?.close()).catch(() => {}).then(() => {
      platform.releaseClipboard?.()
      platform.end?.()
      if (stopping !== pending) return
      stopping = undefined; emit({ type: 'stopped' }, pending.id); pending.resolve()
    })
    return
  }
  if (value.type === 'listed' && value.session === session?.id && listing) { screens = value.screens; const done = listing; listing = undefined; done.resolve(); return }
  if (value.type === 'error' && listing) { const done = listing; listing = undefined; done.reject(new Error(value.message)); return }
  if (value.type === 'error' && value.session === stopping?.id) { emit({ type: 'error', message: value.message }, value.session); void shutdown(); return }
  if (!session || value.session !== session.id || shutting) return
  try {
    if (value.type === 'started') {
      session.screen = value.screen
      session.adapter ??= platform.input(value.screen); session.receiver = createInputReceiver(session.adapter)
    }
    if (value.type === 'frame') { session.direct?.frame(value); worker.postMessage({ type: 'ack', session: session.id }) }
    if (value.type === 'cursor' && session.receiver) {
      const cursor = { type: 'cursor', ...value.value, seq: Math.max(0, session.receiver.sequence), width: session.screen.width, height: session.screen.height }
      if (!validCursor(cursor)) throw new Error('원격 커서를 읽지 못했습니다.')
      emit(cursor)
    }
    if (value.type === 'error') throw new Error(value.message)
  } catch (error) { fail(error) }
})
worker.on('error', () => { emit({ type: 'error', message: '네이티브 GPU 호스트를 준비하지 못했습니다. 하드웨어 H.264·그래픽 드라이버·OS 라이브러리를 확인해 주세요.' }); void shutdown() })
worker.on('exit', () => {
  if (listing) { listing.reject(new Error('GPU 호스트가 종료됐습니다.')); listing = undefined }
  const pending = stopping
  stopping = undefined
  pending?.old.abort?.abort()
  void Promise.all([pending?.old.preparing?.catch(() => {}), pending?.old.networkClosed]).then(() => pending?.old.adapter?.close()).catch(() => {}).finally(() => { platform.end?.(); platform.releaseClipboard?.(); pending?.resolve() })
  if (!shutting) void shutdown()
})
async function message(value) {
  if (shutting) return
  if (value.type === 'lease') { lease = Date.now(); if (session && value.session === session.id) worker.postMessage({ type: 'lease', session: session.id }); return }
  if (value.type === 'stop') { if (value.session === session?.id) await stop(); return }
  if (value.type === 'init') {
    if (!ready || session || stopping || !/^[a-f0-9]{32}$/.test(value.session ?? '')) throw new Error('GPU 호스트의 연결 상태를 확인해 주세요.')
    if (!Array.isArray(value.iceServers) || value.iceServers.some(server => (typeof server.urls === 'string' ? [server.urls] : server.urls)?.some(url => !/^stuns?:/.test(url)))) throw new Error('직접 연결에는 STUN만 사용할 수 있습니다.')
    if (value.udpPort !== undefined && (!Number.isInteger(value.udpPort) || value.udpPort < 1024 || value.udpPort > 65535)) throw new Error('잘못된 UDP 포트입니다.')
    session = { id: value.session, config: value, inputAt: Date.now(), inputCount: 0, abort: new AbortController() }
    await new Promise((resolve, reject) => { listing = { resolve, reject }; worker.postMessage({ type: 'list', session: session.id }) })
    emit({ type: 'sources', platform: process.platform, native: true, screens: screens.map(({ id, label, width, height }) => ({ id, label, width, height })) })
    return
  }
  if (!session || value.session !== session.id) return
  if (value.type === 'select') {
    if (session.direct) throw new Error('화면을 중복 선택할 수 없습니다.')
    const screen = screens.find(screen => screen.id === value.id)
    if (!screen) throw new Error('공유할 화면을 다시 선택해 주세요.')
    const active = session
    active.screen = screen
    active.preparing = Promise.resolve().then(() => platform.prepare?.(active.abort.signal)).then(async prepared => {
      if (session !== active || shutting) { await prepared?.close(); return undefined }
      active.adapter = prepared; return prepared
    })
    await active.preparing
    if (session !== active || shutting) return
    platform.begin?.()
    const scoped = action => { if (session === active && !shutting) action() }
    const capture = type => scoped(() => worker.postMessage({ type, session: active.id }))
    active.direct = nativeDirect(rtc, {
      iceServers: active.config.iceServers, udpPort: active.config.udpPort, emit: value => scoped(() => emit(value)),
      autoNat: active.config.autoNat !== false, localCursor: platform.localCursor, relativeOnly: !!platform.relativeOnly,
      fail: error => scoped(() => fail(error)), keyframe: () => capture('keyframe'),
      connected: () => { if (session === active && !shutting && active.receiver && platform.allowed()) return platform.notify() },
      bitrate: value => scoped(() => worker.postMessage({ type: 'bitrate', session: active.id, value })),
      readClipboard: async () => {
        if (session !== active || shutting || !active.receiver || !platform.allowed()) throw new Error('Clipboard access ended')
        const text = await platform.readClipboard()
        if (session !== active || shutting || !platform.allowed()) throw new Error('Clipboard access ended')
        return text
      },
      input: (value, reliable) => scoped(() => {
        if (!active.receiver) return
        if (!platform.allowed()) throw new Error('데스크톱이 잠겼거나 제어 권한이 종료됐습니다.')
        if (Date.now() - active.inputAt > 1000) { active.inputAt = Date.now(); active.inputCount = 0 }
        if (++active.inputCount > 240) throw new Error('원격 입력이 너무 많습니다.')
        if (reliable && value.type === 'paste') {
          if (typeof value.text !== 'string' || value.text.length > 4096 || value.text.includes('\0')) throw new Error('잘못된 붙여넣기입니다.')
          active.receiver.release()
          void Promise.resolve().then(() => { if (session === active) return platform.clipboard(value.text) }).then(() => scoped(() => {
            if (!platform.allowed()) throw new Error('원격 입력 권한이 종료됐습니다.')
            const modifier = process.platform === 'darwin' ? 'MetaLeft' : 'ControlLeft'
            active.receiver.keyChord([modifier, 'KeyV'])
          })).catch(error => scoped(() => fail(error)))
        } else active.receiver.accept(value, reliable)
      }),
    })
    worker.postMessage({ type: 'start', session: active.id, id: screen.id, source: active.adapter?.source })
  } else if (['answer', 'candidate'].includes(value.type)) session.direct?.signal(value)
  else throw new Error('잘못된 원격 데스크톱 신호입니다.')
}
parent.input.setEncoding('utf8')
parent.input.on('data', chunk => {
  pending += chunk
  if (pending.length > MAX_SIGNAL_BYTES * 2) return void shutdown()
  let end
  while ((end = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, end); pending = pending.slice(end + 1)
    try {
      const value = JSON.parse(line)
      // Revocation/lease must never wait behind the Wayland OS consent dialog.
      if (['stop', 'lease'].includes(value.type)) void message(value).catch(fail)
      else queue = queue.then(() => message(value)).catch(fail)
    } catch (error) { fail(error) }
  }
})
parent.input.on('end', () => { void shutdown() }); parent.input.on('error', () => { void shutdown() }); parent.output.on('error', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() }); process.on('SIGINT', () => { void shutdown() })
