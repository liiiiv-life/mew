// 디스크→방 브리지 e2e: 외부(AI) 디스크 편집이 협업 방(Yjs)에 'agent' 협업자로 주입되고,
// 앱 자신의 자동저장(메아리)은 주입되지 않는지 확인한다. 실제 파일 감시(fs.watch)를 태우려고
// WORKSPACE_ROOT 아래에 임시 프로젝트 폴더를 만들고 끝나면 지운다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { WORKSPACE_ROOT } from './paths.ts'
import { attachCollabAgents } from './collabAgent.ts'
import { noteAppWrite } from './appWrites.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const withFm = (body: string) => `---\ntitle: "T"\n---\n\n${body}`
const fragText = (doc: Y.Doc) => doc.getXmlFragment('default').toString()

test('외부 디스크 편집은 agent로 주입되고, 앱 메아리는 무시된다', async () => {
  const project = `ztest${process.pid}${Math.random().toString(36).slice(2, 6)}`
  const projectDir = path.join(WORKSPACE_ROOT, project)
  const absPath = path.join(projectDir, 'doc.md')
  const roomKey = `${project}:doc.md`

  fs.mkdirSync(projectDir, { recursive: true })
  fs.writeFileSync(absPath, withFm('시작 본문\n'), 'utf-8')

  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  const bridge = attachCollabAgents()

  try {
    await bridge.onOpen(roomKey, { doc, awareness })
    await sleep(50)

    // agent 협업자 정체성이 방 awareness의 로컬 슬롯에 실렸는지
    const user = (awareness.getLocalState() as { user?: { name?: string } } | null)?.user
    assert.equal(user?.name, 'agent', "awareness에 'agent' 사용자가 떠야 한다")

    // ── 외부(AI) 편집 → 방에 주입 ──
    fs.writeFileSync(absPath, withFm('AI가 고친 한 줄\n'), 'utf-8')
    await sleep(500)
    assert.ok(fragText(doc).includes('AI가 고친 한 줄'), '외부 편집이 방에 주입되어야 한다')

    // ── 앱 자동저장(메아리) → 무시 ──
    const echo = withFm('앱이 저장한 다른 줄\n')
    noteAppWrite(absPath, echo) // 앱이 쓴 것으로 먼저 기록
    fs.writeFileSync(absPath, echo, 'utf-8')
    await sleep(500)
    assert.ok(!fragText(doc).includes('앱이 저장한 다른 줄'), '앱 메아리는 방에 주입되면 안 된다')
    assert.ok(fragText(doc).includes('AI가 고친 한 줄'), '메아리 무시 후에도 이전 내용이 유지되어야 한다')
  } finally {
    bridge.onClose(roomKey)
    awareness.destroy()
    doc.destroy()
    fs.rmSync(projectDir, { recursive: true, force: true })
  }
})
