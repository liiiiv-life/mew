// 에디터 화면 분할의 배치 — 잎이 편집 칸(pane) 하나, 가지가 가로(row)·세로(col) 분할이다.
// 탭을 끌어 칸의 가장자리에 놓으면 그 방향으로 갈라지고(splitLeaf), 칸의 마지막 탭을 닫으면
// 그 잎이 빠진다(removeLeaf). 크기는 담지 않는다 — 형제끼리 똑같이 나눠 갖는다.

export type PaneNode = { kind: 'leaf'; pane: string } | { kind: 'split'; dir: 'row' | 'col'; kids: PaneNode[] }

/** 탭을 놓은 자리 — 가장자리면 그 방향으로 분할, 가운데면 그 칸으로 옮기기 */
export type DropSide = 'left' | 'right' | 'top' | 'bottom'
export type DropZone = DropSide | 'center'

/** 가장자리로 볼 폭 — 칸의 바깥 30% */
const EDGE = 0.3

export function leaf(pane: string): PaneNode {
  return { kind: 'leaf', pane }
}

export function paneIds(node: PaneNode): string[] {
  return node.kind === 'leaf' ? [node.pane] : node.kids.flatMap(paneIds)
}

/** 칸 안의 어느 자리에 놓았는지 — 네 가장자리 중 가장 가까운 쪽이 30% 안이면 그 방향 */
export function dropZoneAt(rect: { left: number; top: number; width: number; height: number }, x: number, y: number): DropZone {
  const left = (x - rect.left) / rect.width
  const top = (y - rect.top) / rect.height
  const nearest = Math.min(left, 1 - left, top, 1 - top)
  if (nearest > EDGE) return 'center'
  if (nearest === left) return 'left'
  if (nearest === 1 - left) return 'right'
  return nearest === top ? 'top' : 'bottom'
}

/**
 * target 잎을 그 자리에서 side 방향으로 갈라 newPane을 세운다.
 * 이미 같은 방향의 분할 안에 있으면 중첩하지 않고 **형제로 끼운다** — 3분할이 층층이 쌓이면
 * 칸 하나가 절반의 절반이 되어 버린다.
 */
export function splitLeaf(node: PaneNode, target: string, newPane: string, side: DropSide): PaneNode {
  const dir: 'row' | 'col' = side === 'left' || side === 'right' ? 'row' : 'col'
  const before = side === 'left' || side === 'top'
  if (node.kind === 'leaf') {
    if (node.pane !== target) return node
    return { kind: 'split', dir, kids: before ? [leaf(newPane), node] : [node, leaf(newPane)] }
  }
  const idx = node.kids.findIndex((k) => k.kind === 'leaf' && k.pane === target)
  if (node.dir === dir && idx >= 0) {
    const kids = [...node.kids]
    kids.splice(before ? idx : idx + 1, 0, leaf(newPane))
    return { ...node, kids }
  }
  return { ...node, kids: node.kids.map((k) => splitLeaf(k, target, newPane, side)) }
}

/** 잎 하나를 빼고 홀로 남은 분할은 접는다. 전부 사라지면 null */
export function removeLeaf(node: PaneNode, pane: string): PaneNode | null {
  if (node.kind === 'leaf') return node.pane === pane ? null : node
  const kids = node.kids.map((k) => removeLeaf(k, pane)).filter((k): k is PaneNode => k !== null)
  if (kids.length === 0) return null
  return kids.length === 1 ? kids[0] : { ...node, kids }
}

/**
 * 저장분에서 읽은 배치가 실제 칸 목록과 어긋나면(파일이 깨졌거나 옛 형식) 한 줄 배치로 되돌린다 —
 * 잎이 빠진 칸은 화면에서 통째로 사라지고, 없는 칸을 가리키면 빈 화면이 된다.
 */
export function normalizeLayout(node: PaneNode | null | undefined, ids: string[]): PaneNode {
  const flat: PaneNode = ids.length === 1 ? leaf(ids[0]) : { kind: 'split', dir: 'row', kids: ids.map(leaf) }
  if (!node) return flat
  const inLayout = paneIds(node)
  if (inLayout.length !== ids.length || inLayout.some((id) => !ids.includes(id))) return flat
  return node
}
