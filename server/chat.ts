import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_DIR, readJsonFile, writeFileAtomic } from './dataDir.ts'

// 멤버 간 채팅 — 단체방 하나 + 1:1 DM. 원장은 .data/chat.json이고 실시간 전달은 별도 소켓 없이
// presence 신호({type:'chat'}) + REST 재조회로 한다. 신호에는 내용을 싣지 않는다 —
// presence.broadcast는 게스트에게도 가기 때문이다(ADR 0050).
//
// **방을 따로 만들지 않는다.** 메시지에 `to`(수신자)가 있으면 DM, 없으면 단체방이다. 대화는 보는
// 사람 기준으로 갈린다 — 내가 보낸 DM은 상대별로, 받은 DM은 보낸 사람과의 대화로 묶인다.
//
// 읽음 표시(카톡식 숫자)는 `reads[읽은사람][대화] = 시각` 하나로 센다. 그 시각보다 나중에 온
// 메시지는 아직 안 읽은 것이다. 메시지마다 "아직 안 읽은 수신자 수"를 세어 0이면 표시하지 않는다.
//
// 파일 멘션은 본문 안 `[[프로젝트:상대경로]]` 토큰이다. 서버는 토큰을 해석하지 않는다 —
// 그리는 쪽(ChatPanel)이 파일명 칩으로 바꾸고, 누르면 그 파일을 에디터 탭으로 연다.

export interface ChatMessage {
  id: string
  /** 로그인 이메일 — 세션에서 온다. 요청 본문의 작성자는 신뢰하지 않는다 */
  author: string
  /** 수신자. 없거나 비어 있으면 단체방이다 — 있으면 보낸 사람과 이 사람들만 본다 */
  to?: string[]
  time: number
  text: string
}

/** 화면에 그릴 때 붙는 값 — 이 메시지를 아직 안 읽은 수신자 수. 0이면 숫자를 감춘다 */
export interface ChatMessageView extends ChatMessage {
  unread: number
}

interface ChatFile {
  version: 2
  messages: ChatMessage[]
  /** reads[읽은 사람][대화] = 그 시각까지 읽었다. 대화 키는 GROUP 또는 상대 이메일 */
  reads: Record<string, Record<string, number>>
}

const CHAT_FILE = path.join(DATA_DIR, 'chat.json')
/** 원장 상한 — 넘치면 오래된 것부터 버린다. 채팅은 기록 보관소가 아니다 */
const MAX_MESSAGES = 500
const MAX_TEXT = 4000
/** DM 수신자 상한 — 코멘트 멘션이 여러 명을 지목할 수 있다 */
const MAX_RECIPIENTS = 10

/** 단체방의 대화 키. 이메일에는 '/'가 없으므로 사람 이메일과 부딪히지 않는다 */
export const GROUP = 'group'

export class ChatError extends Error {}

function load(): ChatFile {
  const parsed = readJsonFile<Partial<ChatFile>>(CHAT_FILE)
  if (!parsed || !Array.isArray(parsed.messages)) return { version: 2, messages: [], reads: {} }
  // v1에는 to도 reads도 없었다 — 그때 쓴 글은 전부 단체방이고 아무도 안 읽은 것으로 시작한다
  const reads = parsed.reads && typeof parsed.reads === 'object' ? parsed.reads : {}
  return { version: 2, messages: parsed.messages.filter(isMessage), reads }
}

function isMessage(value: unknown): value is ChatMessage {
  const m = value as ChatMessage | null
  if (!m || typeof m.id !== 'string' || typeof m.author !== 'string' || typeof m.time !== 'number' || typeof m.text !== 'string')
    return false
  return m.to === undefined || (Array.isArray(m.to) && m.to.every((x) => typeof x === 'string'))
}

function save(data: ChatFile): void {
  writeFileAtomic(CHAT_FILE, JSON.stringify(data, null, 2) + '\n')
}

/**
 * 이 메시지가 **보는 사람 기준으로** 어느 대화에 속하는가. 빈 배열이면 볼 수 없는 메시지다.
 * 내가 보낸 DM은 받는 사람마다 하나씩(여러 명을 지목한 코멘트 멘션은 양쪽 대화에 다 보인다),
 * 나에게 온 DM은 보낸 사람과의 대화 하나다.
 */
function conversationsOf(message: ChatMessage, viewer: string): string[] {
  if (!message.to || message.to.length === 0) return [GROUP]
  if (message.author === viewer) return message.to
  return message.to.includes(viewer) ? [message.author] : []
}

/** 이 메시지를 받은 사람이 자기 쪽에서 쓰는 대화 키 — DM이면 보낸 사람, 단체면 GROUP */
function inboxKey(message: ChatMessage): string {
  return message.to && message.to.length > 0 ? message.author : GROUP
}

/** 아직 이 메시지를 안 읽은 수신자 수. 보낸 사람과 이미 지워진 계정은 세지 않는다 */
function unreadCount(message: ChatMessage, members: string[], reads: ChatFile['reads']): number {
  const recipients = message.to && message.to.length > 0 ? message.to : members
  const key = inboxKey(message)
  return recipients.filter(
    (person) => person !== message.author && members.includes(person) && (reads[person]?.[key] ?? 0) < message.time,
  ).length
}

/**
 * 이 사람이 볼 수 있는 메시지 전부(단체 + 자기 DM)와, 대화별로 **내가** 안 읽은 수.
 * 목록이 500줄뿐이라 한 번에 주고 화면이 대화별로 갈라 그린다.
 */
export function listChatFor(viewer: string, members: string[]): { messages: ChatMessageView[]; unread: Record<string, number> } {
  const data = load()
  const messages: ChatMessageView[] = []
  const unread: Record<string, number> = {}
  for (const message of data.messages) {
    const conversations = conversationsOf(message, viewer)
    if (conversations.length === 0) continue
    messages.push({ ...message, unread: unreadCount(message, members, data.reads) })
    if (message.author === viewer) continue
    // 내가 안 읽은 것만 뱃지로 센다 — 내가 보낸 글은 언제나 읽은 것이다
    for (const conversation of conversations) {
      if ((data.reads[viewer]?.[conversation] ?? 0) < message.time) unread[conversation] = (unread[conversation] ?? 0) + 1
    }
  }
  return { messages, unread }
}

/** 현재 사용자가 참여한 대화의 기록을 원장에서 삭제한다. 권한 검사는 API가 담당한다. */
export function deleteChatHistory(viewer: string, conversation: unknown): number {
  if (!viewer || typeof conversation !== 'string' || !conversation.trim() || conversation === viewer)
    throw new ChatError('대화가 필요합니다')
  const data = load()
  const before = data.messages.length
  data.messages = data.messages.filter((message) => !conversationsOf(message, viewer).includes(conversation))
  const deleted = before - data.messages.length
  if (deleted > 0) save(data)
  return deleted
}

/** 수신자 목록 정리 — 문자열만, 자기 자신 제외, 중복 제거. 빈 배열이면 단체방이다 */
function sanitizeRecipients(to: unknown, author: string): string[] {
  if (to === undefined || to === null) return []
  if (!Array.isArray(to)) throw new ChatError('수신자 형식이 잘못됐습니다')
  const list = [...new Set(to.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()))].filter(
    (email) => email !== author,
  )
  if (list.length > MAX_RECIPIENTS) throw new ChatError('수신자가 너무 많습니다')
  return list
}

/** `to`를 주면 DM(보낸 사람 + 수신자만 본다), 안 주면 단체방. 수신자 검증은 부르는 쪽 몫이다 */
export function postChatMessage(author: string, text: unknown, to?: unknown): ChatMessage {
  if (typeof text !== 'string' || !text.trim()) throw new ChatError('내용이 필요합니다')
  if (text.length > MAX_TEXT) throw new ChatError('메시지가 너무 깁니다')
  const recipients = sanitizeRecipients(to, author)
  const data = load()
  // 시각은 원장 안에서 **엄격히 증가**한다. 같은 밀리초에 둘이 들어오면 읽음 포인터(마지막 메시지
  // 시각)와 겹쳐, 화면에 뜬 적도 없는 메시지가 읽은 것으로 묻힌다
  const latestRead = Math.max(0, ...Object.values(data.reads).flatMap((reads) => Object.values(reads)))
  const time = Math.max(Date.now(), (data.messages.at(-1)?.time ?? 0) + 1, latestRead + 1)
  const message: ChatMessage = { id: randomUUID(), author, time, text: text.trim() }
  if (recipients.length > 0) message.to = recipients
  data.messages.push(message)
  if (data.messages.length > MAX_MESSAGES) data.messages.splice(0, data.messages.length - MAX_MESSAGES)
  save(data)
  return message
}

/**
 * 이 대화를 읽었다고 적는다. 대화 키는 GROUP 또는 상대 이메일이다.
 *
 * 찍는 값은 `Date.now()`가 아니라 **읽는 순간 그 대화에 있던 마지막 메시지의 시각**이다. 지금
 * 시각으로 찍으면 같은 밀리초에 도착한 다음 메시지가 읽은 것으로 묻힌다 — 눈앞에 뜬 적도 없는데
 * 숫자가 사라진다. 새로 읽은 것이 없으면 false를 돌려주고 파일도 방송도 건드리지 않는다.
 */
export function markChatRead(viewer: string, conversation: string): boolean {
  if (!viewer || !conversation) return false
  const data = load()
  let latest = 0
  for (const message of data.messages) {
    if (conversationsOf(message, viewer).includes(conversation) && message.time > latest) latest = message.time
  }
  const mine = (data.reads[viewer] ??= {})
  if (latest === 0 || (mine[conversation] ?? 0) >= latest) return false
  mine[conversation] = latest
  save(data)
  return true
}

/** 본문이 멘션하는 계정들 — `@이메일` 그대로 들어 있는 것만 멘션으로 친다(별도 필드 없음) */
export function mentionedEmails(text: string, emails: string[]): string[] {
  return emails.filter((email) => text.includes(`@${email}`))
}
