import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { projectRoot } from './paths.ts'
import { COMMAND_SESSION_PREFIX } from '@mew/tmux-term/server'

// 프로젝트별 명령어 버튼 설정 — <프로젝트>/.mew/cmd-button.json 을 읽고 쓴다.
// 파일은 { "commands": [ { "name": "빌드", "command": "npm run build" }, ... ] } 형태.
// (읽을 때는 최상위가 배열이어도 관대하게 받는다.) 없거나 깨지면 빈 목록.
// 쓸 때는 언제나 { "commands": [...] } 형태로 정규화한다 — 그 밖의 최상위 키는 보존하지 않는다.

export interface CmdButton {
  name: string
  command: string
  /** true면 실행 후 명령이 끝나는 즉시 그 tmux 세션을 스스로 닫는다(배포·빌드 등 일회성 명령용) */
  oneShot?: boolean
}

export class CmdButtonError extends Error {}

const MEW_DIR = '.mew'
const CMD_FILE = 'cmd-button.json'
const MAX_BUTTONS = 50
const MAX_NAME_LEN = 80
const MAX_COMMAND_LEN = 2000

export function readCmdButtons(project: string): CmdButton[] {
  const file = path.join(projectRoot(project), MEW_DIR, CMD_FILE)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch {
    return [] // .mew/cmd-button.json 없음 = 이 프로젝트엔 명령어 버튼이 없다
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return [] // 깨진 JSON은 조용히 무시 — UI엔 "버튼 없음"으로 보인다
  }
  const out: CmdButton[] = []
  for (const item of extractList(parsed)) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name.trim() : ''
    const command = typeof rec.command === 'string' ? rec.command.trim() : ''
    if (!name || !command) continue
    if (name.length > MAX_NAME_LEN || command.length > MAX_COMMAND_LEN) continue
    out.push({ name, command, oneShot: rec.oneShot === true })
    if (out.length >= MAX_BUTTONS) break
  }
  return out
}

/** 클라이언트가 보낸 목록을 검증해 정규화한다 — 통과 못 하면 CmdButtonError(=400). */
export function normalizeCmdButtons(input: unknown): CmdButton[] {
  if (!Array.isArray(input)) throw new CmdButtonError('명령 목록이 배열이 아닙니다')
  if (input.length > MAX_BUTTONS) throw new CmdButtonError(`명령은 최대 ${MAX_BUTTONS}개까지입니다`)
  const out: CmdButton[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (!item || typeof item !== 'object') throw new CmdButtonError('명령 형식이 올바르지 않습니다')
    const rec = item as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name.trim() : ''
    const command = typeof rec.command === 'string' ? rec.command.trim() : ''
    if (!name) throw new CmdButtonError('명령 이름을 입력하세요')
    if (!command) throw new CmdButtonError('명령어를 입력하세요')
    if (name.length > MAX_NAME_LEN) throw new CmdButtonError(`명령 이름은 ${MAX_NAME_LEN}자 이하여야 합니다`)
    if (command.length > MAX_COMMAND_LEN) throw new CmdButtonError(`명령어는 ${MAX_COMMAND_LEN}자 이하여야 합니다`)
    // 실행 세션 이름이 프로젝트+이름 해시라 이름이 겹치면 두 명령이 한 세션을 공유해 버린다
    if (seen.has(name)) throw new CmdButtonError(`이름이 겹칩니다: ${name}`)
    seen.add(name)
    out.push({ name, command, oneShot: rec.oneShot === true })
  }
  return out
}

export function writeCmdButtons(project: string, buttons: CmdButton[]): void {
  const file = path.join(projectRoot(project), MEW_DIR, CMD_FILE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  // oneShot이 false인 경우엔 키를 아예 안 써서 옛 파일과 diff 소음을 줄인다
  const commands = buttons.map((b) => (b.oneShot ? { name: b.name, command: b.command, oneShot: true } : { name: b.name, command: b.command }))
  fs.writeFileSync(tmp, `${JSON.stringify({ commands }, null, 2)}\n`, 'utf-8')
  fs.renameSync(tmp, file) // 쓰는 도중 읽어도 반쪽짜리 JSON을 보지 않도록 (tableLayout.ts와 같은 이유)
}

function extractList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).commands)) {
    return (parsed as { commands: unknown[] }).commands
  }
  return []
}

/**
 * 프로젝트+버튼명으로 결정적인 tmux 세션 이름을 만든다 — 같은 버튼은 늘 같은 세션으로 이어진다.
 * 특수 프리픽스(COMMAND_SESSION_PREFIX) + hex 해시라 세션 이름 규칙([a-zA-Z0-9_-], 50자 이하)을
 * 항상 만족하고, 터미널 탭 목록에서는 이 프리픽스로 걸러져 보이지 않는다.
 */
export function commandSessionName(project: string, name: string): string {
  const hash = crypto.createHash('sha256').update(`${project} ${name}`).digest('hex').slice(0, 16)
  return `${COMMAND_SESSION_PREFIX}${hash}`
}
