// 디스크→방 브리지: AI(또는 다른 외부 도구)가 터미널에서 파일을 직접 고치면, 그 변경을 열려 있는
// 협업 방(Yjs)에 "agent"라는 또 한 명의 협업자가 실시간으로 편집하는 것처럼 주입한다. 사용자에겐
// 화면에 agent 커서가 뜨고 내용이 즉시 반영된다 — 사용자의 한 자씩 자동저장이 AI의 디스크 편집을
// 덮어써 무의미해지던 문제를 해결한다.
//
// 방식: 방마다 헤드리스 tiptap 에디터(클라이언트와 "정확히 같은 스키마" = @mew/editor/server)를
// room.doc(field 'default')에 매어 둔다. ySyncPlugin이 방↔에디터를 계속 동기화하므로, 파일이 외부에서
// 바뀌면 그 본문을 이 에디터에 setContent → updateYFragment의 최소 diff가 방에 반영 → 모든 클라이언트로
// 브로드캐스트된다. 에이전트의 커서는 room.awareness의 로컬 슬롯(서버 relay가 안 쓰던 자리)을 차지한다.
//
// 메아리 차단: 앱 자동저장도 디스크에 쓰므로(api.ts), appWrites 원장으로 "우리가 쓴 것"을 걸러내
// 외부(AI) 변경만 주입한다 — 정상 타이핑이 에이전트와 서로 덮어쓰지 않게 하는 핵심.
import fs from 'node:fs'
import path from 'node:path'
import type { Editor } from '@tiptap/core'
import type { CollabRoom } from './collab.ts'
import { setRoomLifecycle } from './collab.ts'
import { consumeAppWrite } from './appWrites.ts'
import { resolveProjectPath } from './paths.ts'
import { splitFrontmatter } from '@mew/editor/frontmatter'

// 다른 협업자와 구분되는 고정 색 — 팔레트와 겹쳐도 이름('agent')으로 구별된다
const AGENT_COLOR = '#a855f7'
// 파일 이벤트가 저장 한 번에 여러 번 튀고, 쓰기가 채 끝나기 전에 읽으면 잘린 내용을 볼 수 있어
// 마지막 이벤트 뒤 잠깐 기다렸다 처리한다
const DEBOUNCE_MS = 150

interface AgentState {
  editor: Editor
  absPath: string
  watcher: fs.FSWatcher
  timer: NodeJS.Timeout | null
}

const agents = new Map<string, AgentState>()

// ── happy-dom 전역 셧 ────────────────────────────────────────────────────────
// tiptap/ProseMirror는 전역 document·window를 직접 참조하므로 헤드리스로 돌리려면 DOM 셧이 필요하다.
// 첫 에이전트 방이 열릴 때 한 번만, 없는 전역만 채운다(Node가 이미 가진 navigator 등은 건드리지 않음).
let domPromise: Promise<void> | null = null
function ensureDom(): Promise<void> {
  if (!domPromise) domPromise = installDom()
  return domPromise
}
async function installDom(): Promise<void> {
  const { Window } = await import('happy-dom')
  const win = new Window({ url: 'http://localhost' })
  const keys = ['window', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'Text', 'DocumentFragment', 'getComputedStyle', 'MutationObserver'] as const
  const w = win as unknown as Record<string, unknown>
  for (const k of keys) {
    if (k in globalThis) continue // Node에 이미 있으면 덮지 않는다
    try {
      ;(globalThis as Record<string, unknown>)[k] = w[k]
    } catch {
      Object.defineProperty(globalThis, k, { value: w[k], configurable: true })
    }
  }
}

// ── 방 생명주기 ─────────────────────────────────────────────────────────────
function parseRoomKey(roomKey: string): { project: string; relPath: string } | null {
  const idx = roomKey.indexOf(':')
  if (idx <= 0) return null
  return { project: roomKey.slice(0, idx), relPath: roomKey.slice(idx + 1) }
}

// tsconfig.node엔 DOM lib이 없다 — happy-dom 셧으로 런타임엔 존재하는 전역 document를 최소 타입으로 참조
const domGlobal = globalThis as unknown as { document: { createElement(tag: string): unknown } }

async function createEditor(room: CollabRoom): Promise<Editor> {
  await ensureDom()
  // happy-dom 셧을 깐 뒤에 로드해야 tiptap 초기화가 전역 DOM을 본다
  const { Editor } = await import('@tiptap/core')
  const { Collaboration } = await import('@tiptap/extension-collaboration')
  const { CollaborationCaret } = await import('@tiptap/extension-collaboration-caret')
  const { serverEditorExtensions } = await import('@mew/editor/server')

  return new Editor({
    element: domGlobal.document.createElement('div') as never,
    extensions: [
      ...serverEditorExtensions(),
      Collaboration.configure({ document: room.doc, field: 'default' }),
      CollaborationCaret.configure({
        provider: { awareness: room.awareness },
        user: { name: 'agent', color: AGENT_COLOR },
      }),
    ],
    // 방(room.doc)이 진실 원천 — ySyncPlugin이 마운트 즉시 방 내용으로 채운다. content는 방이 빈
    // 초기에만 유효하지만 어차피 곧 클라이언트 sync로 덮이므로 빈 문자열로 둔다.
    content: '',
  })
}

function scheduleReconcile(roomKey: string): void {
  const state = agents.get(roomKey)
  if (!state) return
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(() => {
    state.timer = null
    reconcile(roomKey)
  }, DEBOUNCE_MS)
}

// 디스크 파일이 외부에서 바뀌었을 때 그 본문을 방에 주입한다 (앱 자신의 쓰기·본문 무변경은 건너뜀)
function reconcile(roomKey: string): void {
  const state = agents.get(roomKey)
  if (!state) return

  let content: string
  try {
    content = fs.readFileSync(state.absPath, 'utf-8')
  } catch {
    // 파일이 없거나(삭제/이동 중) 읽기 실패 — 방을 비우지 않는다. 다음 이벤트에서 따라잡는다.
    return
  }

  // 앱(자동저장·커밋)이 방금 쓴 메아리면 무시 — 외부(AI) 변경만 주입한다
  if (consumeAppWrite(state.absPath, content)) return

  const { body } = splitFrontmatter(content)
  const storage = state.editor.storage as { markdown?: { getMarkdown(): string } }
  const current = storage.markdown?.getMarkdown() ?? ''
  // 본문이 그대로면(예: frontmatter만 바뀐 외부 편집) 방을 건드리지 않는다
  if (body === current) return

  // setContent(문자열)은 tiptap-markdown이 마크다운으로 파싱한다. emitUpdate:false여도 ySyncPlugin이
  // 트랜잭션을 가로채 room.doc에 반영하므로(클라이언트의 되돌리기 경로와 동일) 모든 클라이언트에 퍼진다.
  state.editor.commands.setContent(body, { emitUpdate: false })
  // agent 커서가 화면에 보이도록 문서 끝에 둔다 (CollaborationCaret이 awareness로 퍼뜨림)
  state.editor.commands.setTextSelection(state.editor.state.doc.content.size)
}

async function onOpen(roomKey: string, room: CollabRoom): Promise<void> {
  if (agents.has(roomKey)) return
  const parsed = parseRoomKey(roomKey)
  // 마크다운 문서만 — 코드 파일 방(CodePane, Y.Text)은 스키마가 달라 이 브리지 대상이 아니다
  if (!parsed || !parsed.relPath.endsWith('.md')) return

  let absPath: string
  try {
    absPath = resolveProjectPath(parsed.project, parsed.relPath)
  } catch {
    return // 알 수 없는 프로젝트·경로 탈출 등 — 브리지를 붙이지 않는다
  }

  const editor = await createEditor(room)
  // onOpen을 await하는 사이 방이 이미 닫혔거나(doc 파괴됨) 중복 등록됐으면 이 에디터를 버린다
  if (room.doc.isDestroyed || agents.has(roomKey)) {
    editor.destroy()
    return
  }

  // 파일이 있는 디렉터리를 감시한다 — temp+rename으로 저장하는 도구까지 잡기 위해 파일 자체가 아닌
  // 부모 디렉터리를 보고 파일명으로 거른다
  const dir = path.dirname(absPath)
  const base = path.basename(absPath)
  let watcher: fs.FSWatcher
  try {
    watcher = fs.watch(dir, (_event, filename) => {
      // filename이 null인 플랫폼도 있으니 그때는 일단 재검사한다
      if (filename === null || filename === base) scheduleReconcile(roomKey)
    })
  } catch {
    editor.destroy()
    return
  }
  agents.set(roomKey, { editor, absPath, watcher, timer: null })
}

function onClose(roomKey: string): void {
  const state = agents.get(roomKey)
  if (!state) return
  agents.delete(roomKey)
  if (state.timer) clearTimeout(state.timer)
  state.watcher.close()
  // 에디터 파괴 — room.doc/awareness는 호출부(collab.ts)가 이 다음에 파괴한다
  state.editor.destroy()
}

// relay가 부르는 생명주기 훅 묶음 — 테스트가 방을 직접 만들어 onOpen/onClose를 호출할 수 있도록 반환한다
export interface CollabAgentBridge {
  onOpen(roomKey: string, room: CollabRoom): Promise<void>
  onClose(roomKey: string): void
}
let bridge: CollabAgentBridge | null = null

/** 협업 relay에 디스크→방 브리지를 붙인다 (serve.ts·plugin.ts에서 한 번 호출) */
export function attachCollabAgents(): CollabAgentBridge {
  if (bridge) return bridge
  bridge = { onOpen, onClose }
  setRoomLifecycle({
    onOpen: (roomKey, room) => {
      void onOpen(roomKey, room).catch((err) => console.error('[mew] collabAgent onOpen 실패:', err))
    },
    onClose: (roomKey) => onClose(roomKey),
  })
  return bridge
}
