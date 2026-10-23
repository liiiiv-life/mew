import { desktopInput, type InputSnapshot } from '../utils/desktop-input.ts'
import type { DesktopConnection, DesktopConnector } from '../utils/desktop-connection.ts'
import type { DemoWorkspaceStore } from './workspace-store.ts'

/** Procedural pixels and local input only: no display capture, RTC peer or host socket. */
export function createDemoDesktop(store: DemoWorkspaceStore) {
  const connections = new Set<DesktopConnection>()
  const connect: DesktopConnector = (events, preferred) => {
    const canvas = document.createElement('canvas')
    canvas.width = 960; canvas.height = 600
    const context = canvas.getContext('2d', { alpha: false })!
    const selected = preferred === 'terminal' ? 'terminal' : 'workspace'
    let closed = false, dirty = true, pointer = [.64, .67], previous: InputSnapshot | undefined
    let stream: MediaStream | undefined
    let text = store.getState('desktop-note', 'Mew를 자유롭게 둘러보세요.')
    let clipboard = text
    const input = desktopInput(message => connection.fail(message))
    const channel = { readyState: 'open' as const, bufferedAmount: 0, send(raw: string) {
      if (closed) return
      const value = JSON.parse(raw)
      if (value.type === 'clipboard-read') queueMicrotask(() => input.message(JSON.stringify({ type: 'clipboard', id: value.id, text: clipboard })))
      if (value.type === 'paste') { text += value.text; clipboard = value.text; dirty = true }
      if (value.type === 'input') {
        const snapshot = value as InputSnapshot
        if (snapshot.point) pointer = snapshot.point
        else if (previous) pointer = [Math.max(0, Math.min(1, pointer[0] + (snapshot.x - previous.x) / canvas.width)), Math.max(0, Math.min(1, pointer[1] + (snapshot.y - previous.y) / canvas.height))]
        for (const key of snapshot.keys.filter(key => !previous?.keys.includes(key))) {
          if (snapshot.keys.some(key => /^(Control|Meta|Alt)/.test(key))) {
            if (key === 'KeyC') clipboard = text
            if (key === 'KeyV') text += clipboard
            continue
          }
          if (/^Key[A-Z]$/.test(key)) text += key.slice(3).toLowerCase()
          else if (/^Digit\d$/.test(key)) text += key.slice(5)
          else if (key === 'Space') text += ' '
          else if (key === 'Backspace') text = text.slice(0, -1)
          else if (key === 'Enter') text += '\n'
        }
        previous = snapshot; dirty = true
      }
      text = text.slice(-1200); store.setState('desktop-note', text)
    } }
    input.connect('motion', channel); input.connect('control', channel)
    const label = (value: string, x: number, y: number, size = 14, color = '#dbe2ec', mono = false) => {
      context.fillStyle = color; context.font = `${size}px ${mono ? 'monospace' : 'sans-serif'}`; context.fillText(value, x, y)
    }
    const panel = (x: number, y: number, width: number, height: number, title: string) => {
      context.fillStyle = '#202731'; context.fillRect(x, y, width, height)
      context.fillStyle = '#2b3440'; context.fillRect(x, y, width, 36)
      label(title, x + 16, y + 24, 13)
    }
    const draw = () => {
      context.fillStyle = '#141c25'; context.fillRect(0, 0, 960, 600)
      context.fillStyle = '#26313e'; context.fillRect(0, 0, 960, 36)
      label('mew   /   demo desktop', 22, 24, 14, '#ebeff5')
      label('브라우저 안의 가상 화면 · 실제 장치에 연결되지 않음', 514, 24, 12, '#b7c6d7')
      panel(24, 60, 206, 484, 'mew-playground')
      ;['README.md', 'docs/', '  welcome.md', '  guides/', '  features/', '  tasks/', 'src/', '  main.tsx', 'shared/', '  features.ts'].forEach((item, index) => label(item, 42, 124 + index * 31, 14, index === 2 ? '#a1dcb5' : '#b7c6d7', true))
      panel(250, 60, 686, 484, selected === 'terminal' ? 'Terminal · 로컬 시뮬레이션' : 'docs/welcome.md · Mew 데모')
      if (selected === 'terminal') {
        ;['visitor@mew-demo:~/mew $ npm run check', 'Mew demo: checks are simulated.', 'No real commands are executed.', '', '✓ 문서·코드 편집', '✓ 기능·태스크·Git', '✓ 원격 화면·시스템·Android 체험'].forEach((line, index) => label(line, 274, 130 + index * 34, 16, index === 0 ? '#a1dcb5' : '#dbe2ec', true))
      } else {
        label('Mew를 Mew 안에서 둘러보세요', 278, 148, 27, '#f0f4fa')
        label('이 화면도 데모입니다. 키보드나 입력 도구로 메모를 바꿔 보세요.', 278, 190)
        label('파일 · 문서 · 에이전트 · 터미널 · Git · 기능 · 태스크', 278, 224, 14, '#a1dcb5')
      }
      context.fillStyle = '#16202b'; context.fillRect(274, 364, 638, 152)
      label('체험 메모', 290, 391, 12, '#a1dcb5')
      const lines = text.split('\n').flatMap(line => line.match(/.{1,42}/gu) ?? ['']).slice(-4)
      lines.forEach((line, index) => label(line, 290, 418 + index * 25, 16))
      label('Demo workspace   ·   변경은 이 탭에서만 유지됩니다.', 250, 577, 13, '#b7c6d7')
      const [x, y] = [pointer[0] * 960, pointer[1] * 600]
      context.fillStyle = '#f4f8ff'; context.beginPath(); context.moveTo(x, y); context.lineTo(x + 4, y + 20); context.lineTo(x + 9, y + 13); context.lineTo(x + 18, y + 12); context.closePath(); context.fill()
      if (typeof VideoFrame === 'function' && events.frame) {
        const frame = new VideoFrame(canvas, { timestamp: Math.round(performance.now() * 1000) })
        try { events.frame(frame) } finally { frame.close() }
      } else if (!stream) {
        stream = canvas.captureStream(10); events.transport?.('direct'); events.stream(stream)
      }
      dirty = false
    }
    const timer = setInterval(() => { if (!closed) { input.flushMotion(performance.now()); if (dirty) draw() } }, 50)
    const connection: DesktopConnection = { input, close() {
      if (closed) return
      closed = true; clearInterval(timer); input.close(); stream?.getTracks().forEach(track => track.stop()); canvas.width = canvas.height = 0; connections.delete(connection)
    }, fail(message) { if (!closed) { connection.close(); events.state('error', message) } } }
    connections.add(connection)
    queueMicrotask(() => {
      if (closed) return
      events.transport?.('server'); events.relative(false)
      events.screens([{ id: 'workspace', label: 'Mew workspace · Demo', width: 960, height: 600 }, { id: 'terminal', label: 'Terminal · Demo', width: 960, height: 600 }], selected)
      draw(); events.stats('Demo · 960 × 600 · 로컬 시뮬레이션'); events.state('connected', '데모 화면에 연결됨')
    })
    return connection
  }
  const unsubscribe = store.subscribe(event => { if (event.type === 'reset' || event.type === 'close') for (const connection of [...connections]) connection.close() })
  return { connect, close() { unsubscribe(); for (const connection of [...connections]) connection.close() } }
}
