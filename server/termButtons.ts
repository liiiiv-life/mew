import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, writeFileAtomic } from './dataDir.ts'
import { normalizeIconValue, SvgIconError } from './svgIcon.ts'

// 터미널 명령어 버튼 — 터미널 패널의 버튼 줄에 뜨고, 지금 열려 있는 tmux 세션에 명령을 그대로
// "타이핑 + Enter"로 보낸다. 프로젝트별인 .mew/cmd-button.json(cmdButtons.ts)과 달리 **전역**이라
// 모든 프로젝트·탭이 같은 목록을 공유하므로 프로젝트 폴더가 아니라 .data/에 서버가 저장한다.
// (.data/는 paths.ts deny 목록이라 편집 API로는 열리지 않는다 — UI의 +·꾹 누르기가 편집 수단이다.)
//
// 파일 형식: { "commands": [ { "name": "정리", "command": "/clear", "icon": "i:sparks" }, ... ] }
// icon은 프로젝트 아이콘과 **같은 표기**다(`i:{키}` · 이모지 · `svg:{마크업}`) — 검사도 같은
// svgIcon.ts를 쓰고, 화면에서 그리는 것도 같은 컴포넌트다(IconPicker·ProjectIcon).
// iconOnly를 켜면 버튼 줄에서 이름을 감추고 아이콘만 그린다.

const TERM_FILE = path.join(DATA_DIR, 'term-button.json')

const MAX_BUTTONS = 30
const MAX_NAME_LEN = 40
const MAX_COMMAND_LEN = 2000

export interface TermButton {
  name: string
  command: string
  icon?: string
  iconOnly?: boolean
}

export class TermButtonError extends Error {}

/** 저장할 형태로 조립한다 — 아이콘이 없으면 감출 이름도 없으므로 iconOnly는 버린다 */
function toButton(name: string, command: string, icon: string, iconOnly: boolean): TermButton {
  if (!icon) return { name, command }
  return iconOnly ? { name, command, icon, iconOnly: true } : { name, command, icon }
}

export function readTermButtons(): TermButton[] {
  let raw: string
  try {
    raw = fs.readFileSync(TERM_FILE, 'utf-8')
  } catch {
    return [] // 아직 버튼을 하나도 안 만든 상태
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return [] // 깨진 JSON은 조용히 무시 — UI엔 "버튼 없음"으로 보인다
  }
  const out: TermButton[] = []
  for (const item of extractList(parsed)) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name.trim() : ''
    const command = typeof rec.command === 'string' ? rec.command.trim() : ''
    const rawIcon = typeof rec.icon === 'string' ? rec.icon.trim() : ''
    if (!name || !command) continue
    if (name.length > MAX_NAME_LEN || command.length > MAX_COMMAND_LEN) continue
    // 손으로 고친 파일에 이상한 아이콘이 들어 있어도 버튼까지 버리지는 않는다 — 아이콘만 떨군다
    let icon: string
    try {
      icon = normalizeIconValue(rawIcon)
    } catch {
      icon = ''
    }
    out.push(toButton(name, command, icon, rec.iconOnly === true))
    if (out.length >= MAX_BUTTONS) break
  }
  return out
}

function extractList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).commands)) {
    return (parsed as { commands: unknown[] }).commands
  }
  return []
}

/** 클라이언트가 보낸 목록을 검증해 정규화한다 — 통과 못 하면 TermButtonError(=400). */
export function normalizeTermButtons(input: unknown): TermButton[] {
  if (!Array.isArray(input)) throw new TermButtonError('버튼 목록이 배열이 아닙니다')
  if (input.length > MAX_BUTTONS) throw new TermButtonError(`버튼은 최대 ${MAX_BUTTONS}개까지입니다`)
  const out: TermButton[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') throw new TermButtonError('버튼 형식이 올바르지 않습니다')
    const rec = item as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name.trim() : ''
    const command = typeof rec.command === 'string' ? rec.command.trim() : ''
    const rawIcon = typeof rec.icon === 'string' ? rec.icon.trim() : ''
    if (!name) throw new TermButtonError('버튼 이름을 입력하세요')
    if (!command) throw new TermButtonError('명령어를 입력하세요')
    if (name.length > MAX_NAME_LEN) throw new TermButtonError(`버튼 이름은 ${MAX_NAME_LEN}자 이하여야 합니다`)
    if (command.length > MAX_COMMAND_LEN) throw new TermButtonError(`명령어는 ${MAX_COMMAND_LEN}자 이하여야 합니다`)
    // 아이콘 검사는 프로젝트 아이콘과 같은 함수 — 왜 안 받았는지가 그대로 사용자에게 간다
    let icon: string
    try {
      icon = normalizeIconValue(rawIcon)
    } catch (err) {
      throw new TermButtonError(err instanceof SvgIconError ? err.message : '아이콘 값이 올바르지 않습니다')
    }
    out.push(toButton(name, command, icon, rec.iconOnly === true))
  }
  return out
}

export function writeTermButtons(buttons: TermButton[]): void {
  // 임시 파일 + rename — 저장 도중 죽어도 반쪽짜리 JSON이 남지 않는다 (dataDir.ts)
  writeFileAtomic(TERM_FILE, `${JSON.stringify({ commands: buttons }, null, 2)}\n`, 0o644)
}
