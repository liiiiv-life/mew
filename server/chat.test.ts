// 멤버 채팅(.data/chat.json) — 단체방·DM 가시성, 읽음 숫자, 상한, 멘션 판정 (MEW_DATA_DIR가 임시 경로).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './dataDir.ts'
import { ChatError, GROUP, listChatFor, markChatRead, mentionedEmails, postChatMessage } from './chat.ts'

const A = 'a@x.com'
const B = 'b@x.com'
const C = 'c@x.com'
const MEMBERS = [A, B, C]

function resetChat() {
  fs.rmSync(path.join(DATA_DIR, 'chat.json'), { force: true })
}

const textsFor = (viewer: string) => listChatFor(viewer, MEMBERS).messages.map((m) => m.text)

test('postChatMessage → listChatFor 왕복', () => {
  resetChat()
  const sent = postChatMessage(A, '안녕 [[proj:notes/a.md]]')
  const { messages } = listChatFor(A, MEMBERS)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].id, sent.id)
  assert.equal(messages[0].author, A)
  assert.equal(messages[0].text, '안녕 [[proj:notes/a.md]]')
  assert.equal(messages[0].to, undefined, 'to가 없으면 단체방이다')
  resetChat()
})

test('DM은 보낸 사람과 받는 사람만 본다', () => {
  resetChat()
  postChatMessage(A, '모두에게')
  postChatMessage(A, 'B에게만', [B])

  assert.deepEqual(textsFor(A), ['모두에게', 'B에게만'], '보낸 사람은 자기 DM을 본다')
  assert.deepEqual(textsFor(B), ['모두에게', 'B에게만'], '받는 사람도 본다')
  assert.deepEqual(textsFor(C), ['모두에게'], '남의 DM은 목록에 실리지도 않는다')
  resetChat()
})

test('자기 자신은 수신자에서 빠지고, 남은 수신자가 없으면 단체방이 된다', () => {
  resetChat()
  const dm = postChatMessage(A, '나 포함 지목', [A, B])
  assert.deepEqual(dm.to, [B])
  const solo = postChatMessage(A, '나만 지목', [A])
  assert.equal(solo.to, undefined)
  assert.deepEqual(textsFor(C), ['나만 지목'], '수신자가 없으면 단체방이라 C도 본다')
  resetChat()
})

test('읽음 숫자 — 아직 안 읽은 수신자 수, 다 읽으면 0', () => {
  resetChat()
  postChatMessage(A, '단체 인사')

  const seenByA = () => listChatFor(A, MEMBERS).messages[0].unread
  assert.equal(seenByA(), 2, '보낸 사람 뺀 나머지 둘이 아직 안 읽었다')

  markChatRead(B, GROUP)
  assert.equal(seenByA(), 1)
  markChatRead(C, GROUP)
  assert.equal(seenByA(), 0, '모두 읽으면 0 — 화면에서 숫자를 감춘다')

  // 읽은 뒤에 온 메시지는 다시 안 읽은 상태다 — 같은 밀리초에 들어와도 마찬가지여야 한다
  postChatMessage(A, '그 다음 말')
  assert.equal(listChatFor(A, MEMBERS).messages[1].unread, 2)
  resetChat()
})

test('같은 밀리초에 여러 줄이 들어와도 시각이 겹치지 않는다 — 읽음 포인터와 부딪힌다', () => {
  resetChat()
  const times = Array.from({ length: 20 }, (_, i) => postChatMessage(A, `연속 ${i}`).time)
  assert.equal(new Set(times).size, times.length, '시각이 모두 다르다')
  assert.deepEqual([...times].sort((x, y) => x - y), times, '순서대로 증가한다')
  resetChat()
})

test('DM의 읽음은 그 대화 기준이다 — 단체방을 읽어도 DM은 안 읽은 채다', () => {
  resetChat()
  postChatMessage(A, 'B에게만', [B])
  const unreadOf = () => listChatFor(A, MEMBERS).messages[0].unread

  assert.equal(unreadOf(), 1)
  markChatRead(B, GROUP)
  assert.equal(unreadOf(), 1, '단체방을 읽은 것은 DM과 무관하다')
  markChatRead(B, A) // B가 "A와의 대화"를 읽었다
  assert.equal(unreadOf(), 0)
  resetChat()
})

test('대화별 안 읽은 수 — 내가 보낸 것은 세지 않는다', () => {
  resetChat()
  postChatMessage(B, '단체 하나')
  postChatMessage(B, 'A에게 DM', [A])
  postChatMessage(A, '내가 쓴 단체 글')

  const forA = listChatFor(A, MEMBERS)
  assert.deepEqual(forA.unread, { [GROUP]: 1, [B]: 1 }, '단체 1 · B와의 대화 1')

  markChatRead(A, B)
  assert.deepEqual(listChatFor(A, MEMBERS).unread, { [GROUP]: 1 }, '읽은 대화는 목록에서 빠진다')
  resetChat()
})

test('지워진 계정은 읽음 계산에서 빠진다 — 숫자가 영영 안 내려가면 안 된다', () => {
  resetChat()
  postChatMessage(A, '단체 인사')
  markChatRead(B, GROUP)
  // C가 계정 목록에서 사라졌다
  assert.equal(listChatFor(A, [A, B]).messages[0].unread, 0)
  resetChat()
})

test('빈 내용은 거부한다', () => {
  assert.throws(() => postChatMessage(A, '  '), ChatError)
  assert.throws(() => postChatMessage(A, 42), ChatError)
  assert.throws(() => postChatMessage(A, '안녕', 'b@x.com'), ChatError, '수신자는 배열이어야 한다')
})

test('상한을 넘으면 오래된 메시지부터 버린다', () => {
  resetChat()
  for (let i = 0; i < 505; i++) postChatMessage(A, `m${i}`)
  const { messages } = listChatFor(A, MEMBERS)
  assert.equal(messages.length, 500)
  assert.equal(messages[0].text, 'm5')
  assert.equal(messages.at(-1)?.text, 'm504')
  resetChat()
})

test('v1 원장(to·reads 없음)도 그대로 읽는다', () => {
  resetChat()
  const file = path.join(DATA_DIR, 'chat.json')
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, messages: [{ id: 'old', author: A, time: 1, text: '옛날 글' }] }) + '\n',
  )
  const { messages } = listChatFor(C, MEMBERS)
  assert.deepEqual(messages.map((m) => m.text), ['옛날 글'], '옛 메시지는 전부 단체방이다')
  assert.equal(messages[0].unread, 2)
  resetChat()
})

test('mentionedEmails — @이메일이 그대로 들어 있는 것만 멘션이다', () => {
  const emails = [A, B]
  assert.deepEqual(mentionedEmails(`@${A} 봐줘`, emails), [A])
  assert.deepEqual(mentionedEmails(`${A} 멘션 아님(@ 없음)`, emails), [])
  assert.deepEqual(mentionedEmails(`@${A} @${B}`, emails), [A, B])
})
