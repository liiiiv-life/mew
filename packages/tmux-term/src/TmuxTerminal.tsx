import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Check, Copy, FastArrowDown, FrameSelect, Lock, Xmark } from 'iconoir-react'
import { HoverTipLayer, hasPathDrag, keepFocusOnPress, pathFromDrag } from '@mew/ui'
import { MobileKeyBar, useMobileLayout } from '@mew/mobile-keys'
import { getBinding, matchesShortcut } from '@mew/shortcuts'
import { readInputDraft, writeInputDraft } from './inputDrafts'
import { readKeyboardLock, writeKeyboardLock } from './keyboardLock'

function arrowSequence(dir: 'up' | 'down' | 'left' | 'right', ctrl: boolean, shift: boolean): string {
  const letter = { up: 'A', down: 'B', right: 'C', left: 'D' }[dir]
  const mod = ctrl && shift ? 6 : ctrl ? 5 : shift ? 2 : 1
  return mod === 1 ? `\x1b[${letter}` : `\x1b[1;${mod}${letter}`
}

// navigator.clipboard는 https·localhost에서만 존재한다. LAN/Tailscale IP를 http로 접속하면
// undefined라 복사가 조용히 실패하므로, 그럴 땐 execCommand('copy') 폴백으로 넘어간다.
async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 권한 거부 등 — 아래 폴백을 시도한다
    }
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// 터미널 스크롤백 + 보이는 화면 전체를 텍스트로 직렬화한다 (선택이 없을 때 "출력 전체 복사"용)
function serializeBuffer(term: Terminal): string {
  const buf = term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i)
    lines.push(line ? line.translateToString(true) : '')
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

// 터미널 영역 안에서 이뤄진 브라우저 네이티브 텍스트 선택(모바일 롱프레스 등)을 가져온다
function nativeSelectionWithin(el: HTMLElement): string {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return ''
  return sel.anchorNode && el.contains(sel.anchorNode) ? sel.toString() : ''
}

// 텍스트를 보낸 뒤 제출용 Enter(\r)를 이만큼 늦게, 별도 메시지로 보낸다 — 텍스트와 같은 read로 도착하면
// TUI가 붙여넣기 개행으로 흡수해 제출이 안 되기 때문. 서버는 메시지마다 pty.write를 따로 하므로 이 정도
// 간격이면 자식 프로세스가 텍스트와 Enter를 별개 입력으로 받는다.
const SUBMIT_ENTER_DELAY_MS = 80

/** SGR(1006) 마우스 휠 한 칸 — 64=위, 65=아래. tmux·앱이 이 형식으로 휠을 받는다 */
function sgrWheel(direction: 'up' | 'down', col: number, row: number): string {
  return `\x1b[<${direction === 'up' ? 64 : 65};${col};${row}M`
}

// "맨 아래"가 앱(Claude Code처럼 마우스를 잡는 TUI)에게 휠을 내려 보낼 때의 분량과 속도.
// 한 뭉치로 몰아 보내면 앱이 한 read에 담긴 이벤트를 한 번의 스크롤로 뭉개 조금밖에 안 내려간다 —
// 버튼을 계속 눌러줘야 했던 이유다. 사람이 굴리듯 잘게 나눠 여러 번 보내면 한 번 눌러 최신까지 닿는다.
const JUMP_WHEEL_TICKS_PER_BURST = 12
const JUMP_WHEEL_BURSTS = 20
const JUMP_WHEEL_BURST_MS = 40

// 버튼 줄 오른쪽 도구 버튼(아이콘 하나) — 켜고 끄는 버튼은 켜졌을 때 강조색으로 바뀐다
const TOOL_BUTTON_CLASS =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded border border-edge text-ink-secondary hover:bg-surface-raised hover:text-ink'
const TOOL_BUTTON_ON_CLASS =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded border border-accent bg-surface-raised text-accent'

export function TmuxTerminal({
  sessionName,
  activeFilePath,
  getSelectedText,
  renderCommandButtons,
  wsPath = '/api/tmux/ws',
}: {
  sessionName: string
  activeFilePath?: string | null
  /** 에디터에서 선택된 텍스트가 있으면 반환 — Ctrl+L이 경로 대신 이 텍스트를 우선 삽입한다 */
  getSelectedText?: () => string | null
  /**
   * 버튼 줄 왼쪽에 끼워 넣을 호스트 앱 UI(명령어 버튼 등). 인자로 받은 run을 부르면 지금 보고 있는
   * 이 세션에 "타이핑 + Enter"로 명령이 들어간다 — 하단 입력칸의 전송과 완전히 같은 경로라
   * Claude Code 같은 TUI에서도 그대로 제출된다.
   */
  renderCommandButtons?: (run: (command: string) => void) => ReactNode
  wsPath?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeFilePathRef = useRef(activeFilePath)
  const getSelectedTextRef = useRef(getSelectedText)
  const wsRef = useRef<WebSocket | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const ctrlActiveRef = useRef(false)
  const [ctrlActive, setCtrlActive] = useState(false)
  const [shiftActive, setShiftActive] = useState(false)
  const [focused, setFocused] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  // 하단 입력칸은 세션별 초안을 브라우저에 저장한다 — 탭을 옮기거나(이 컴포넌트는 key={session}으로
  // 세션마다 새로 마운트된다) 닫았다 열어도, 새로고침해도 쓰던 내용이 남는다.
  const [command, setCommand] = useState(() => readInputDraft(sessionName))
  const [selectMode, setSelectMode] = useState(false)
  // 모바일 소프트 키보드 잠금 — 기기 설정에 가까워 세션이 아니라 브라우저에 남는다(keyboardLock.ts)
  const [keyboardLocked, setKeyboardLocked] = useState(readKeyboardLock)
  const [selectSnapshot, setSelectSnapshot] = useState('')
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  const [connState, setConnState] = useState<'connecting' | 'open' | 'reconnecting'>('connecting')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const selectPreRef = useRef<HTMLPreElement>(null)
  const selectModeRef = useRef(false)
  // "맨 아래"가 나눠 보내는 휠 뭉치 — 다시 누르거나 언마운트되면 남은 뭉치를 버린다
  const jumpTimerRef = useRef<number | null>(null)
  const jumpBurstsLeftRef = useRef(0)
  const mobileLayout = useMobileLayout()

  useEffect(() => {
    activeFilePathRef.current = activeFilePath
  }, [activeFilePath])

  useEffect(() => {
    getSelectedTextRef.current = getSelectedText
  }, [getSelectedText])

  useEffect(() => {
    ctrlActiveRef.current = ctrlActive
  }, [ctrlActive])

  useEffect(() => {
    selectModeRef.current = selectMode
  }, [selectMode])

  // 키보드 잠금: xterm이 입력을 받는 보조 textarea에 inputMode='none'을 걸면 포커스는 그대로인 채
  // 소프트 키보드만 올라오지 않는다 — 블러시키는 방법과 달리 붙여넣기·하드웨어 키보드는 살아 있다.
  // (하단 입력칸은 JSX에서 같은 값을 준다.) 켜는 순간 이미 올라와 있는 키보드는 포커스를 놓아 내린다.
  useEffect(() => {
    const ta = termRef.current?.textarea
    if (ta) ta.inputMode = keyboardLocked ? 'none' : ''
    if (keyboardLocked && document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }, [keyboardLocked])

  // 선택 모드를 켜면 스냅샷 오버레이를 최신(맨 아래)으로 스크롤해 방금 보던 터미널 화면과 맞춘다
  useEffect(() => {
    if (selectMode && selectPreRef.current) {
      selectPreRef.current.scrollTop = selectPreRef.current.scrollHeight
    }
  }, [selectMode])

  // 입력칸 내용을 세션별 초안으로 저장한다 — 전송하면 command가 ''가 되어 초안도 함께 지워진다
  useEffect(() => {
    writeInputDraft(sessionName, command)
  }, [sessionName, command])

  // 저장된 초안이 여러 줄이면 마운트 시 textarea 높이를 내용에 맞춘다 (onInput은 타이핑할 때만 실행됨)
  useEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }, [sessionName])

  // 하단 입력칸에 포커스가 있을 때도 보조키 바의 Ctrl을 쓸 수 있게 한다. Ctrl이 켜진 상태에서 글자를
  // 하나 입력하면 그 글자를 제어 코드로 바꿔 termux(PTY)로 보낸다(입력칸엔 안 들어감). 모바일 IME는
  // keydown에 글자를 안 실어주는 경우가 많아(keyCode 229) beforeinput으로 가로챈다 — 터미널 onData와 동일.
  useEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    function onBeforeInput(e: InputEvent) {
      if (!ctrlActiveRef.current || e.inputType !== 'insertText') return
      const ch = e.data
      if (!ch || ch.length !== 1 || !/[a-zA-Z]/.test(ch)) return
      e.preventDefault()
      const w = wsRef.current
      if (w?.readyState === WebSocket.OPEN) {
        w.send(JSON.stringify({ type: 'input', data: String.fromCharCode(ch.toUpperCase().charCodeAt(0) - 64) }))
      }
      ctrlActiveRef.current = false
      setCtrlActive(false)
    }
    ta.addEventListener('beforeinput', onBeforeInput)
    return () => ta.removeEventListener('beforeinput', onBeforeInput)
  }, [])

  function send(data: string) {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'input', data }))
  }

  // 하단 입력창의 내용을 "터미널에 입력하고 Enter를 누른 것"과 동일하게 PTY에 보낸다.
  // - 한 줄이면 raw로 보낸다 → Claude Code 같은 TUI가 "타이핑"으로 보고, 뒤이어 따로 오는 \r을 진짜
  //   Enter(=제출)로 인식한다. bracketed paste(\x1b[200~…201~)로 감싸면 Claude Code는 그 \r을 붙여넣기
  //   확정에 써버려 제출이 안 된다(입력만 됨). bash는 감싸도 제출되지만 Claude Code는 아니라 안 감싸는 게 안전.
  // - 여러 줄이면 bracketed paste로 감싼다 → 중간 줄바꿈이 조기 제출로 새지 않게(내용 보존 우선).
  // - 제출용 \r은 텍스트와 다른 read로 도착하도록 살짝 늦게 따로 보낸다(같은 read면 붙여넣기 개행으로 흡수됨).
  function sendAsTyped(text: string) {
    if (text) {
      const term = termRef.current
      const body = text.replace(/\r?\n/g, '\r')
      const wrap = body.includes('\r') && term?.modes.bracketedPasteMode
      send(wrap ? `\x1b[200~${body}\x1b[201~` : body)
    }
    window.setTimeout(() => send('\r'), SUBMIT_ENTER_DELAY_MS)
  }

  // 하단 입력칸의 커서 자리에 글자를 끼워 넣는다 (사이드바에서 끌어다 놓은 파일 경로).
  // 선택 영역이 있으면 그 자리를 대신하고, 커서를 알 수 없으면 끝에 붙인다.
  function insertIntoCommand(text: string) {
    const ta = inputRef.current
    const from = ta?.selectionStart ?? command.length
    const to = ta?.selectionEnd ?? from
    setCommand(command.slice(0, from) + text + command.slice(to))
    // 값이 반영된 다음 프레임에 커서를 끼워 넣은 글자 끝으로 옮기고 높이를 다시 맞춘다
    const caret = from + text.length
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(caret, caret)
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    })
  }

  function submitCommand() {
    const text = command
    setCommand('')
    const ta = inputRef.current
    if (ta) ta.style.height = 'auto' // 자동 늘어난 높이를 한 줄로 되돌린다
    // 여기서 ta.focus()를 그냥 부르면 키보드를 내려둔 채 전송할 때 키보드가 도로 올라온다 —
    // 뺏겼을 때만 되돌리는 refocusActive에 맡긴다
    refocusActive()
    sendAsTyped(text)
  }

  // "맨 아래" 버튼: 스크롤을 최신 출력으로 되돌린다. 올라가 있는 스크롤을 **누가 들고 있는지**가
  // 셋으로 갈리므로 세 가지를 다 한다 — 각각 나머지 상황에서는 아무 일도 하지 않는다.
  //  1) xterm 자체 스크롤백 (마우스 트래킹 꺼짐) → scrollToBottom
  //  2) tmux copy-mode (마우스 트래킹 켜짐 + 셸처럼 마우스를 안 쓰는 프로그램) → 서버에 copy-mode -q를
  //     맡긴다. PTY로 q·Esc를 보내면 모드가 아닐 때 실행 중인 TUI에 오입력된다.
  //  3) 앱이 직접 스크롤 (Claude Code처럼 마우스를 잡는 TUI) → tmux는 휠을 그 앱에 넘겨줬을 뿐이라
  //     copy-mode도 아니고 xterm 스크롤백도 아니다. 1·2가 통하지 않던 게 이 경우다.
  //     사용자가 손으로 하듯 휠 아래를 잘게 나눠 계속 보내 앱 스스로 최신까지 내려가게 한다.
  function stopJumpBursts() {
    if (jumpTimerRef.current !== null) {
      window.clearInterval(jumpTimerRef.current)
      jumpTimerRef.current = null
    }
    jumpBurstsLeftRef.current = 0
  }

  function jumpToBottom() {
    const w = wsRef.current
    if (w?.readyState === WebSocket.OPEN) w.send(JSON.stringify({ type: 'exitCopyMode' }))
    const term = termRef.current
    term?.scrollToBottom()
    stopJumpBursts()
    if (term && term.modes.mouseTrackingMode !== 'none') {
      // 화면 한가운데를 가리키는 휠 이벤트 — 어느 열·행이든 pane 안이면 되지만 가장자리는 피한다
      const col = Math.max(1, Math.ceil(term.cols / 2))
      const row = Math.max(1, Math.ceil(term.rows / 2))
      const burst = sgrWheel('down', col, row).repeat(JUMP_WHEEL_TICKS_PER_BURST)
      jumpBurstsLeftRef.current = JUMP_WHEEL_BURSTS - 1
      send(burst) // 첫 뭉치는 곧바로 — 눌렀는데 아무 반응 없는 순간이 없게
      jumpTimerRef.current = window.setInterval(() => {
        if (jumpBurstsLeftRef.current <= 0) {
          stopJumpBursts()
          return
        }
        jumpBurstsLeftRef.current--
        send(burst)
        termRef.current?.scrollToBottom()
      }, JUMP_WHEEL_BURST_MS)
    }
    // 선택 모드 스냅샷은 켠 시점 화면에 고정돼 있으므로 그 오버레이도 맨 아래로 맞춰준다
    if (selectPreRef.current) selectPreRef.current.scrollTop = selectPreRef.current.scrollHeight
  }

  // 세션을 옮기거나 터미널을 닫으면 남은 휠 뭉치를 버린다 (죽은 소켓에 계속 쏘지 않게)
  useEffect(
    () => () => {
      if (jumpTimerRef.current !== null) window.clearInterval(jumpTimerRef.current)
    },
    [],
  )

  // 복사 버튼: 선택 영역이 있으면(xterm 드래그 선택 또는 터치 네이티브 선택) 그걸, 없으면 터미널
  // 출력 전체를 클립보드에 넣는다. 비보안 컨텍스트(IP+http)에서도 되도록 copyToClipboard가 폴백한다.
  async function copySelectionOrScreen() {
    const term = termRef.current
    if (!term) return
    let text = term.getSelection()
    if (!text && selectPreRef.current) text = nativeSelectionWithin(selectPreRef.current)
    if (!text && containerRef.current) text = nativeSelectionWithin(containerRef.current)
    if (!text) text = serializeBuffer(term)
    const ok = await copyToClipboard(text)
    setCopied(ok ? 'ok' : 'fail')
    window.setTimeout(() => setCopied(null), 1500)
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const containerEl = container

    // 항상 최신 소켓(wsRef.current)으로 보낸다 — 재연결로 소켓이 교체돼도 아래 핸들러들이 그대로 동작한다
    const sendRaw = (obj: { type: string; data?: string; cols?: number; rows?: number }) => {
      const w = wsRef.current
      if (w?.readyState === WebSocket.OPEN) w.send(JSON.stringify(obj))
    }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
      },
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitAddon.fit()
    termRef.current = term

    const onFocus = () => setFocused(true)
    const onBlur = () => setFocused(false)
    term.textarea?.addEventListener('focus', onFocus)
    term.textarea?.addEventListener('blur', onBlur)

    // OSC 52 — tmux copy-mode의 y나 내부 프로그램(vim 등)이 클립보드를 설정하면 브라우저
    // 클립보드로 전달한다. xterm.js는 기본으로 OSC 52를 무시하므로 직접 핸들러를 단다.
    // navigator.clipboard가 없는 비보안 컨텍스트(IP+http)에서도 되도록 copyToClipboard가 폴백한다.
    const osc52Disposable = term.parser.registerOscHandler(52, (data) => {
      const payload = data.slice(data.indexOf(';') + 1)
      if (!payload || payload === '?') return true // 클립보드 읽기 질의는 지원하지 않음
      try {
        const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
        void copyToClipboard(new TextDecoder().decode(bytes))
      } catch {
        // 잘못된 base64 — 무시
      }
      return true
    })

    // 드래그 선택이 멈추면 곧바로 클립보드에 복사 — 웹 터미널에서 Ctrl+C는 SIGINT라서
    // 복사 단축키로 쓸 수 없고, Ctrl+Shift+C는 브라우저(DevTools)가 예약하고 있다.
    let selectionTimer: number | null = null
    const selectionDisposable = term.onSelectionChange(() => {
      if (selectionTimer !== null) window.clearTimeout(selectionTimer)
      selectionTimer = window.setTimeout(() => {
        selectionTimer = null
        const text = term.getSelection()
        if (text) void copyToClipboard(text)
      }, 200)
    })

    // Ctrl+L: 에디터에 선택된 텍스트가 있으면 그 텍스트를, 없으면 마지막으로 열려있던 파일의
    // 프로젝트 상대경로를 셸 입력에 그대로 꽂아준다 (둘 다 없으면 원래 동작인 화면 지우기로 통과)
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      // 탭 이동은 호스트 앱의 전역 단축키다 — PTY로 흘려보내면 셸에 화살표 이스케이프가 찍히므로
      // 여기서 삼키고(preventDefault 없이) window까지 버블링만 시킨다
      if (matchesShortcut(event, getBinding('prevTab')) || matchesShortcut(event, getBinding('nextTab'))) return false
      if (!matchesShortcut(event, getBinding('insertPathOrSelection'))) return true
      const text = getSelectedTextRef.current?.() || activeFilePathRef.current
      if (!text) return true
      event.preventDefault()
      sendRaw({ type: 'input', data: text })
      return false
    })

    // 에디터에서 누른 Ctrl+L의 [경로:줄] 참조 — 호스트 앱이 window 이벤트로 broadcast하고,
    // 마운트된 활성 세션 터미널이 셸 입력으로 받아 적는다 (에이전트 패널도 같은 이벤트를 받는다)
    const onInsertRef = (e: Event) => sendRaw({ type: 'input', data: (e as CustomEvent<{ text: string }>).detail.text })
    window.addEventListener('mew:insert-ref', onInsertRef)

    // ── 자동 재연결 ──────────────────────────────────────────────────────────────
    // 모바일 네트워크 끊김·탭 백그라운드로 WebSocket이 죽어도 tmux 세션은 서버에 그대로 살아 있다
    // (서버는 ws가 닫히면 attach 클라이언트만 죽이고 세션은 남긴다). 다시 붙기만 하면 tmux가 현재
    // 화면을 통째로 다시 그려 복구된다. 지수 백오프로 재접속하고, 탭 복귀·온라인 복귀 땐 즉시 시도한다.
    let disposed = false
    let reconnectTimer: number | null = null
    let attempts = 0

    function openSocket() {
      if (disposed) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(
        `${protocol}//${location.host}${wsPath}?session=${encodeURIComponent(sessionName)}&cols=${term.cols}&rows=${term.rows}`,
      )
      wsRef.current = ws
      ws.onopen = () => {
        attempts = 0
        setConnState('open')
        // 재접속 직후 현재 크기를 알려 tmux가 뷰포트를 다시 맞추고 화면을 갱신하게 한다
        sendRaw({ type: 'resize', cols: term.cols, rows: term.rows })
      }
      ws.onmessage = (event) => {
        if (typeof event.data === 'string') term.write(event.data)
      }
      ws.onclose = () => {
        if (disposed) return
        setConnState('reconnecting')
        scheduleReconnect()
      }
      // onerror 뒤엔 항상 onclose가 따라오므로 재접속 처리는 onclose 한 곳에서만 한다
      ws.onerror = () => {}
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimer !== null) return
      const delay = Math.min(10000, 500 * 2 ** attempts) // 0.5s에서 시작해 최대 10s
      attempts++
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        openSocket()
      }, delay)
    }

    // 탭 복귀/온라인 복귀 시 대기 중인 백오프를 건너뛰고 곧바로 재접속한다 (사용자가 수동으로 하던 것)
    function reconnectNow() {
      if (disposed) return
      if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return // 이미 연결됨/연결 중
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      attempts = 0
      openSocket()
    }

    function onVisible() {
      if (document.visibilityState === 'visible') reconnectNow()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', reconnectNow)

    openSocket()

    const dataDisposable = term.onData((data) => {
      // 보조키 바에서 Ctrl을 켜둔 상태로 실제 문자를 하나 치면 그 문자를 제어 코드로 바꿔 보낸다
      // (Ctrl+C, Ctrl+D 같은 진짜 터미널 조작 — Termux의 Ctrl 키와 동일한 동작)
      let out = data
      if (ctrlActiveRef.current && data.length === 1 && /[a-zA-Z]/.test(data)) {
        out = String.fromCharCode(data.toUpperCase().charCodeAt(0) - 64)
        ctrlActiveRef.current = false
        setCtrlActive(false)
      }
      sendRaw({ type: 'input', data: out })
    })

    // fitAddon.fit()이 실제로 cols/rows를 바꿀 때만 발생 — 여기서 서버에 리사이즈를 알린다
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      sendRaw({ type: 'resize', cols, rows })
    })

    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(container)

    // tmux는 attach 시 마우스 트래킹을 켜므로(예: `mouse on`), 그 상태에선 xterm.js가 자체
    // 스크롤백을 쓰지 않고 휠 입력을 SGR 마우스 코드로 tmux에 그대로 전달해야 스크롤이 된다.
    // 터치는 네이티브 wheel 이벤트가 없어서, 드래그를 직접 SGR 시퀀스로 인코딩해 PTY에 써준다
    // (term.modes.mouseTrackingMode로 활성 여부를 매번 확인 — 꺼져 있으면 xterm 자체 스크롤백 사용).
    const WHEEL_TICK_PX = 24
    function sendWheelTick(direction: 'up' | 'down', clientX: number, clientY: number) {
      if (term.modes.mouseTrackingMode === 'none') {
        term.scrollLines(direction === 'up' ? -3 : 3)
        return
      }
      const rect = containerEl.getBoundingClientRect()
      const col = Math.min(term.cols, Math.max(1, Math.floor(((clientX - rect.left) / rect.width) * term.cols) + 1))
      const row = Math.min(term.rows, Math.max(1, Math.floor(((clientY - rect.top) / rect.height) * term.rows) + 1))
      sendRaw({ type: 'input', data: sgrWheel(direction, col, row) })
    }
    let lastTouchY: number | null = null
    let pendingDeltaY = 0
    function onTouchStart(e: TouchEvent) {
      // 선택 모드에선 터치를 가로채지 않는다 — 브라우저 네이티브 텍스트 선택(롱프레스)이 동작하게 둔다
      if (selectModeRef.current) return
      lastTouchY = e.touches.length === 1 ? e.touches[0].clientY : null
      pendingDeltaY = 0
    }
    function onTouchMove(e: TouchEvent) {
      if (selectModeRef.current || lastTouchY === null || e.touches.length !== 1) return
      // 브라우저가 이 드래그를 페이지 스크롤 제스처로 채가지 못하도록 매 이동마다 막는다
      // (임계값을 넘긴 뒤에만 막으면 이미 네이티브 스크롤이 시작된 뒤일 수 있음)
      e.preventDefault()
      const touch = e.touches[0]
      // 위로 스와이프(값 감소) = 최신 쪽으로 스크롤(down), 아래로 스와이프 = 과거 기록으로(up)
      pendingDeltaY += lastTouchY - touch.clientY
      lastTouchY = touch.clientY
      while (Math.abs(pendingDeltaY) >= WHEEL_TICK_PX) {
        sendWheelTick(pendingDeltaY > 0 ? 'down' : 'up', touch.clientX, touch.clientY)
        pendingDeltaY -= Math.sign(pendingDeltaY) * WHEEL_TICK_PX
      }
    }
    function onTouchEnd() {
      lastTouchY = null
      pendingDeltaY = 0
    }
    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      disposed = true
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', reconnectNow)
      window.removeEventListener('mew:insert-ref', onInsertRef)
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      term.textarea?.removeEventListener('focus', onFocus)
      term.textarea?.removeEventListener('blur', onBlur)
      resizeObserver.disconnect()
      if (selectionTimer !== null) window.clearTimeout(selectionTimer)
      osc52Disposable.dispose()
      selectionDisposable.dispose()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      wsRef.current?.close()
      term.dispose()
      wsRef.current = null
      termRef.current = null
    }
  }, [sessionName, wsPath])

  // 보조키 조작 뒤 포커스(=모바일 키보드)를 원래 있던 곳으로 되돌린다 — 하단 입력칸을 쓰던 중이면
  // 입력칸으로, 아니면 터미널로. 덕분에 입력칸에 포커스를 둔 채로 보조키만 termux로 쏠 수 있다.
  // 아무 데도 포커스가 없었으면(키보드를 내려둔 채 방향키만 쓰는 경우) 그대로 둔다 — 안 그러면
  // 보조키를 누를 때마다 내려둔 키보드가 도로 올라온다.
  //
  // 포커스가 이미 제자리면 focus()를 아예 부르지 않는다. 소프트 키보드를 뒤로가기·내리기 제스처로
  // 내려도 포커스는 입력칸·터미널에 그대로 남아 blur가 오지 않으므로(=inputFocused/focused는 계속
  // true다), 그 상태에서 focus()를 부르면 크로미움이 이미 포커스된 요소여도 "키보드를 다시 띄워
  // 달라"는 뜻으로 받아 내려둔 키보드를 도로 올린다. 키보드가 떠 있을 때 눌러도 keepFocusOnPress가
  // 포커스를 지켜 주므로 되돌릴 것이 없고, 진짜로 뺏긴 경우에만 아래 두 줄이 일한다.
  function refocusActive() {
    const active = document.activeElement
    if (active === inputRef.current || active === termRef.current?.textarea) return
    if (inputFocused) inputRef.current?.focus()
    else if (focused) termRef.current?.focus()
  }

  return (
    // onMouseDown: 이 안의 버튼을 눌러도 포커스를 뺏지 않는다 — 키보드가 내려가며 레이아웃이 커지면
    // 버튼이 손가락 밑에서 밀려나 click이 통째로 사라지기 때문(keepFocusOnPress 주석 참고)
    <div className="flex h-full flex-col overflow-hidden" onMouseDown={keepFocusOnPress}>
      <div className="relative min-h-0 flex-1">
        {/* 사이드바에서 파일을 끌어다 놓으면 그 경로가 셸에 타이핑된다 (Enter는 보내지 않는다 —
            명령을 완성하는 건 사용자다). 바깥에서 끌어온 그냥 텍스트도 같은 대접을 한다. */}
        <div
          ref={containerRef}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={(e) => {
            e.preventDefault()
            const dropped = pathFromDrag(e.dataTransfer) ?? e.dataTransfer.getData('text/plain')
            if (dropped) send(dropped)
          }}
          className="h-full overflow-hidden bg-surface-deep p-1"
        />
        {/* 선택 모드: xterm 위에 현재 화면을 담은 선택 가능한 스냅샷을 덮는다. xterm의 터치 선택은
            뷰포트/헬퍼 textarea가 터치를 가로채 모바일에서 잘 안 먹으므로, 순수 <pre>를 깔아 롱프레스로
            확실히 선택·복사되게 한다(켜는 순간의 화면을 고정 — 그 사이 출력은 밑 xterm에 계속 쌓임). */}
        {selectMode && (
          <pre
            ref={selectPreRef}
            className="absolute inset-0 m-0 select-text overflow-auto whitespace-pre p-1"
            style={{
              background: '#0a0a0a',
              color: '#e5e5e5',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 13,
              lineHeight: 1.2,
            }}
          >
            {selectSnapshot}
          </pre>
        )}
      </div>
      {/* 이 줄의 버튼은 전부 아이콘 하나짜리라 이름이 안 보인다 — data-tip이 붙은 것에 마우스를
          올리면 HoverTipLayer가 곧바로 이름표를 띄운다(기본 title은 1초쯤 기다려야 나온다). */}
      <HoverTipLayer className="flex shrink-0 items-center gap-1.5 border-t border-edge bg-surface px-2 py-1">
        {/* 왼쪽: 연결 상태 + 호스트 앱의 명령어 버튼. 버튼이 많아지면 이 영역만 가로 스크롤된다 */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {connState !== 'open' && (
            <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-ink-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-strong" />
              {connState === 'connecting' ? '연결 중…' : '재연결 중…'}
            </span>
          )}
          {renderCommandButtons?.(sendAsTyped)}
        </div>
        {/* 오른쪽 도구는 전부 아이콘 하나짜리다 — 좁은 화면에서 왼쪽 명령어 버튼 자리를 뺏지 않게.
            무슨 버튼인지는 data-tip(마우스 올리기)과 aria-label이 말한다. title은 걸지 않는다 —
            이름표가 뜬 뒤에 브라우저 기본 툴팁이 겹쳐 뜬다. */}
        <button
          type="button"
          onClick={jumpToBottom}
          data-tip="맨 아래로 이동"
          aria-label="맨 아래로 이동"
          className={TOOL_BUTTON_CLASS}
        >
          <FastArrowDown width={15} height={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !keyboardLocked
            setKeyboardLocked(next)
            writeKeyboardLock(next)
          }}
          aria-pressed={keyboardLocked}
          data-tip="모바일 키보드 잠금"
          aria-label="모바일 키보드 잠금"
          className={keyboardLocked ? TOOL_BUTTON_ON_CLASS : TOOL_BUTTON_CLASS}
        >
          <Lock width={15} height={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !selectMode
            if (next && termRef.current) setSelectSnapshot(serializeBuffer(termRef.current))
            setSelectMode(next)
          }}
          aria-pressed={selectMode}
          data-tip="모바일용 터미널 텍스트 선택기"
          aria-label="선택 모드"
          className={selectMode ? TOOL_BUTTON_ON_CLASS : TOOL_BUTTON_CLASS}
        >
          <FrameSelect width={15} height={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={copySelectionOrScreen}
          data-tip="선택모드에서 선택된 내용 복사"
          aria-label="복사"
          className={TOOL_BUTTON_CLASS}
        >
          {copied === 'ok' ? (
            <Check width={15} height={15} strokeWidth={1.8} />
          ) : copied === 'fail' ? (
            <Xmark width={15} height={15} strokeWidth={1.8} />
          ) : (
            <Copy width={15} height={15} strokeWidth={1.8} />
          )}
        </button>
      </HoverTipLayer>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submitCommand()
        }}
        className="flex shrink-0 items-end gap-1.5 border-t border-edge bg-surface px-2 py-1.5"
      >
        <textarea
          ref={inputRef}
          value={command}
          rows={1}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onChange={(e) => setCommand(e.target.value)}
          onInput={(e) => {
            // 내용에 맞춰 높이를 자동으로 늘린다 (최대 160px, 넘으면 자체 스크롤)
            const ta = e.currentTarget
            ta.style.height = 'auto'
            ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
          }}
          onKeyDown={(e) => {
            // Ctrl+Enter(맥은 Cmd+Enter)로 전송, 그냥 Enter는 줄바꿈 — 여러 줄 입력용
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
              e.preventDefault()
              submitCommand()
            }
          }}
          // 사이드바에서 끌어온 파일 항목만 직접 처리한다 — 그 외 텍스트 드롭은 브라우저 기본 동작에 맡긴다
          // (controlled textarea라 직접 넣지 않으면 값이 되돌아간다)
          onDragOver={(e) => {
            // dragover에서는 값을 읽을 수 없어 types만 본다 (hasPathDrag 주석 참고)
            if (!hasPathDrag(e.dataTransfer)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={(e) => {
            const draggedPath = pathFromDrag(e.dataTransfer)
            if (!draggedPath) return
            e.preventDefault()
            insertIntoCommand(draggedPath)
          }}
          placeholder={keyboardLocked ? '키보드 잠금 중 — 자물쇠를 눌러 해제' : '여러 줄 입력 가능 · Ctrl+Enter로 전송'}
          // 잠금 중에는 여기서도 소프트 키보드가 뜨지 않는다 — 포커스·붙여넣기는 그대로 된다
          inputMode={keyboardLocked ? 'none' : 'text'}
          enterKeyHint="enter"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 resize-none rounded border border-edge bg-surface-deep px-2 py-1 font-mono text-sm text-ink outline-none focus:border-accent"
        />
        <button
          type="submit"
          title="전송 (Ctrl+Enter)"
          className="shrink-0 rounded border border-edge bg-surface-raised px-3 py-1 text-sm text-ink-secondary hover:bg-surface-hover hover:text-ink"
        >
          전송
        </button>
      </form>
      {/* 모바일이면 키보드가 떠 있든 아니든 항상 둔다 — 키보드를 내린 채 방향키로 스크롤하고
          Esc를 보내는 쓰임이 더 많다. 보조키는 포커스와 무관하게 PTY로 바로 나간다. */}
      {mobileLayout && (
        <MobileKeyBar
          ctrlActive={ctrlActive}
          shiftActive={shiftActive}
          onToggleCtrl={() => setCtrlActive((v) => !v)}
          onToggleShift={() => setShiftActive((v) => !v)}
          onEsc={() => {
            send('\x1b')
            refocusActive()
          }}
          onTab={() => {
            send(shiftActive ? '\x1b[Z' : '\t')
            setShiftActive(false)
            refocusActive()
          }}
          onArrow={(dir) => {
            send(arrowSequence(dir, ctrlActive, shiftActive))
            setCtrlActive(false)
            setShiftActive(false)
            refocusActive()
          }}
        />
      )}
    </div>
  )
}
