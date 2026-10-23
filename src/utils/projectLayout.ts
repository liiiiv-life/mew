// 프로젝트가 어느 자리에 서는지 — 탭 줄의 순서와 팝업 격자의 칸(slot)은 **같은 값** 하나로 정해진다
// (서버 .data/project-layout.json). 그래서 계산도 여기 한 곳에 둔다: 탭을 끌어 순서를 바꾸든
// 격자에서 타일을 옮기든 결과가 갈라지지 않는다.
import type { ProjectInfo } from '../api/client'

/** 탭 줄·격자의 표시 순서 — 팝업에서 끌어 정한 자리(slot)를 그대로 따른다 */
export function bySlot(a: ProjectInfo, b: ProjectInfo): number {
  const sa = a.slot ?? Number.MAX_SAFE_INTEGER
  const sb = b.slot ?? Number.MAX_SAFE_INTEGER
  return sa === sb ? a.name.localeCompare(b.name) : sa - sb
}

/** 저장된 자리대로 타일을 격자에 놓는다 — 자리가 없거나 겹치는 프로젝트는 앞쪽 빈 칸부터 채운다 */
export function buildPlacement(projects: ProjectInfo[]): Map<number, string> {
  const placed = new Map<number, string>()
  const rest: string[] = []
  for (const p of projects) {
    // slot을 모르는 서버(구버전)가 응답하면 undefined로 오므로 == null로 함께 거른다
    if (p.slot == null || placed.has(p.slot)) rest.push(p.name)
    else placed.set(p.slot, p.name)
  }
  let cursor = 0
  for (const name of rest) {
    while (placed.has(cursor)) cursor++
    placed.set(cursor, name)
  }
  return placed
}

/** 게스트는 배치를 바꿀 수 없고 안 보이는 프로젝트 자리가 구멍으로 남으므로, 순서만 살려 앞에서부터 채운다 */
export function compactPlacement(projects: ProjectInfo[]): Map<number, string> {
  const order = [...projects].sort(bySlot)
  return new Map(order.map((p, i) => [i, p.name]))
}

/**
 * 탭 줄에서 from번째 탭을 to번째로 옮겼을 때의 새 배치(이름 → 칸 번호).
 * **쓰이는 칸은 그대로 두고 순서만 바꾼다** — 격자에 일부러 비워둔 자리가 탭을 끈다고 메워지면
 * 팝업의 배치가 통째로 무너지기 때문이다. 옮길 것이 없으면 null.
 */
export function reorderedLayout(
  projects: ProjectInfo[],
  from: number,
  to: number,
): Record<string, number> | null {
  const ordered = [...projects].sort(bySlot)
  if (from === to || from < 0 || to < 0 || from >= ordered.length || to >= ordered.length) return null
  // 지금 쓰이고 있는 칸들 — 개수는 프로젝트 수와 같고, 오름차순이 곧 탭 줄의 순서다
  const slots = [...buildPlacement(ordered).keys()].sort((a, b) => a - b)
  const names = ordered.map((p) => p.name)
  const [moved] = names.splice(from, 1)
  names.splice(to, 0, moved)
  const layout: Record<string, number> = {}
  names.forEach((name, i) => {
    layout[name] = slots[i]
  })
  return layout
}

/** 새 배치를 프로젝트 목록에 반영한다 — 배치에 없는 프로젝트(안 보이는 것)는 건드리지 않는다 */
export function applyLayout(projects: ProjectInfo[], layout: Record<string, number>): ProjectInfo[] {
  return projects.map((p) => (layout[p.name] === undefined ? p : { ...p, slot: layout[p.name] }))
}
