import { app, BrowserWindow, desktopCapturer, ipcMain, screen, systemPreferences, clipboard } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInputReceiver, MAX_SIGNAL_BYTES } from './protocol.mjs'
import { createNativeInput } from './input-native.mjs'
import { parentChannel } from './parent-channel.mjs'
import { hostFrame } from './host-wire.mjs'
import { readFrame, MAX_FRAME_BYTES } from './relay-protocol.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const parent = parentChannel()
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-desktop-'))
app.setPath('userData', temporary)
app.setAppLogsPath(path.join(temporary, 'logs'))
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
let window, config, sources = [], adapter, receiver, rendererReady = false, closing = false, lease = Date.now(), started = false
let startQueue = Promise.resolve()
let transport = 'direct', inputWindow = Date.now(), inputCount = 0
const emit = (value) => { if (!parent.output.destroyed) parent.output.write(`MEW_DESKTOP ${JSON.stringify(value)}\n`) }
function acceptInput(value, reliable) {
  if (!receiver || closing) return
  if (Date.now() - inputWindow > 1000) { inputWindow = Date.now(); inputCount = 0 }
  if (++inputCount > 240) throw new Error('원격 입력이 너무 많습니다. 다시 연결해 주세요.')
  if (value?.type === 'paste' && reliable && typeof value.text === 'string' && value.text.length <= 4096) {
    receiver.release()
    clipboard.writeText(value.text)
    const modifier = process.platform === 'darwin' ? 'MetaLeft' : 'ControlLeft'
    try { adapter.key(modifier, true); adapter.key('KeyV', true) }
    finally { try { adapter.key('KeyV', false) } finally { adapter.key(modifier, false) } }
  } else receiver.accept(value, reliable === true)
}
async function stop() {
  if (closing) return
  closing = true
  clearInterval(watchdog)
  try { receiver?.release() } catch { /* Still close the OS input session below. */ }
  try { await Promise.race([adapter?.close(), new Promise((resolve) => setTimeout(resolve, 500))]) } catch { /* Best effort before terminating the owned process. */ }
  window?.destroy()
  try { fs.rmSync(temporary, { recursive: true, force: true }) } catch { /* Windows can retain a Chromium handle until exit. */ }
  app.exit(0)
}
function fail(error) { emit({ type: 'error', message: error instanceof Error ? error.message : '원격 데스크톱을 시작할 수 없습니다.' }); void stop() }
const watchdog = setInterval(() => { try { if (Date.now() - lease > 8000 || receiver?.tick()) void stop() } catch (error) { fail(error) } }, 250)
async function listSources() {
  if (!config || !rendererReady) return
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(true)) throw new Error('Mac 시스템 설정에서 원격 데스크톱 보조 앱의 손쉬운 사용 권한을 허용한 뒤 다시 연결해 주세요.')
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'denied') throw new Error('Mac 시스템 설정에서 원격 데스크톱 보조 앱의 화면 기록 권한을 허용한 뒤 다시 연결해 주세요.')
  sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
  if (!sources.length) throw new Error('공유할 화면이 없습니다. 서버에 로그인한 데스크톱과 화면 공유 권한을 확인해 주세요.')
  const displays = screen.getAllDisplays(), primary = screen.getPrimaryDisplay().id
  sources.sort((a, b) => Number(b.display_id === String(primary)) - Number(a.display_id === String(primary)))
  emit({ type: 'sources', platform: process.platform, screens: sources.map((source) => {
    const display = displays.find((display) => String(display.id) === source.display_id)
    return { id: source.id, label: source.name, width: display?.size.width ?? 1920, height: display?.size.height ?? 1080 }
  }) })
}
async function start(id) {
  const source = sources.find((item) => item.id === id)
  if (!source || closing) throw new Error('공유할 화면을 다시 선택해 주세요.')
  receiver?.release(); await adapter?.close(); receiver = null
  const display = screen.getAllDisplays().find((item) => String(item.id) === source.display_id) ?? screen.getPrimaryDisplay()
  let bounds = display.bounds
  if (process.platform === 'win32') {
    const origin = screen.dipToScreenPoint({ x: bounds.x, y: bounds.y })
    bounds = { ...origin, width: bounds.width * display.scaleFactor, height: bounds.height * display.scaleFactor }
  }
  adapter = await createNativeInput({ platform: process.platform, wayland: !!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland', bounds })
  if (closing) { await adapter.close(); return }
  receiver = createInputReceiver(adapter)
  started = true
  window.webContents.send('desktop:signal', { type: 'start', source: source.id, iceServers: config.iceServers, relativeOnly: !!adapter.relativeOnly })
}
let pending = ''
parent.input.setEncoding('utf8')
parent.input.on('data', (chunk) => {
  pending += chunk
  if (pending.length > MAX_SIGNAL_BYTES * 2) return fail(new Error('잘못된 원격 연결 메시지입니다.'))
  let end
  while ((end = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, end); pending = pending.slice(end + 1)
    try {
      const message = JSON.parse(line)
      if (message.type === 'lease') { lease = Date.now(); continue }
      if (message.type === 'stop') { void stop(); continue }
      if (message.type === 'init' && !config) { config = message; void listSources().catch(fail); continue }
      if (message.type === 'select' && config) { startQueue = startQueue.then(() => start(message.id)).catch(fail); continue }
      if (started && message.type === 'relay' && transport === 'direct') { transport = 'relay'; receiver?.pause(); window.webContents.send('desktop:signal', message); continue }
      if (started && transport === 'relay' && message.type === 'relay-input') { acceptInput(message.value, message.reliable); continue }
      if (started && (transport === 'direct' && ['answer', 'candidate'].includes(message.type) || transport === 'relay' && message.type === 'frame-ack')) window.webContents.send('desktop:signal', message)
    } catch (error) { fail(error) }
  }
})
parent.input.on('end', () => { void stop() })
parent.input.on('error', () => { void stop() })
process.on('SIGTERM', () => { void stop() })
process.on('SIGINT', () => { void stop() })
parent.output.on('error', () => { void stop() })
app.on('before-quit', (event) => { if (!closing) { event.preventDefault(); void stop() } })

async function createWindow() {
  await app.whenReady()
  if (closing) return
  window = new BrowserWindow({ show: false, width: 320, height: 200, webPreferences: { preload: path.join(directory, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'mew-desktop' } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('render-process-gone', () => fail(new Error('원격 화면 전송이 종료됐습니다. 다시 연결해 주세요.')))
  const owned = (event) => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
  // Chromium also gates local WebRTC paths through Local Network Access. Only
  // this fixed local renderer receives these permissions, never navigated content.
  const permissions = new Set(['media', 'local-network-access', 'local-network', 'loopback-network'])
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(contents === window.webContents && permissions.has(permission)))
  window.webContents.session.setPermissionCheckHandler((contents, permission) => contents === window.webContents && permissions.has(permission))
  ipcMain.on('desktop:ready', (event) => { if (owned(event)) { rendererReady = true; void listSources().catch(fail) } })
  ipcMain.on('desktop:signal', (event, value) => {
    if (!owned(event) || !value || JSON.stringify(value).length > MAX_SIGNAL_BYTES) return
    if (['offer', 'candidate', 'connected', 'direct-failed'].includes(value.type) && transport === 'direct') emit(value)
    if (value.type === 'direct-failed') receiver?.pause()
    if (['relay-ready', 'error'].includes(value.type)) emit(value)
    if (value.type === 'error' || value.type === 'closed') void stop()
  })
  ipcMain.on('desktop:input', (event, value, reliable) => {
    if (!owned(event) || transport !== 'direct') return
    try { acceptInput(value, reliable) } catch (error) { fail(error) }
  })
  ipcMain.on('desktop:frame', (event, value) => {
    if (!owned(event) || transport !== 'relay' || closing) return
    try {
      const packet = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      readFrame(packet)
      if (parent.output.writableLength > MAX_FRAME_BYTES * 2) throw new Error('서버로 보내는 영상이 지연됐습니다. 다시 연결해 주세요.')
      parent.output.write(hostFrame(packet))
    } catch (error) { fail(error) }
  })
  await window.loadFile(path.join(directory, 'app.html'))
}
// Electron must finish evaluating the ESM entry before app readiness can resolve.
void createWindow().catch(fail)
