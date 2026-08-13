import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  FOOTNOTE_MARKER_RE,
  REFERENCES_HEADING_RE,
  fromSubscript,
  markerFor,
  nextMarkerNumber,
  planFootnotes,
} from '../utils/footnotes.ts'

// 각주 — Alt+E로 커서 자리에 마커(`₁₎`)를 박고, 문서 맨 아래 `# References` 구역과 번호를 맞춘다.
// 번호 계산은 utils/footnotes.ts(순수·테스트 있음)가 하고, 여기서는 그 계획을 PM 문서에 적용한다.
//
// **내용은 건드리지 않는다.** 번호가 밀릴 때 문단을 통째로 다시 쓰면 참고문헌에 걸어 둔 링크·굵기가
// 날아간다. 그래서 하는 일은 셋뿐이다: 번호 글자만 갈아끼우기 · 빈 문단 하나 끼우기 · 문단 하나 지우기.
//
// 마커가 하나도 없으면 **아무것도 하지 않는다.** 손으로 쓴 References를 지우지 않기 위한 안전장치다
// (마지막 각주를 지우면 마지막 줄이 남는다 — 남의 글을 자동으로 지우는 것보다 낫다).

export interface FootnoteOptions {
  /** 마커를 눌렀다 — 그 번호의 내용을 툴팁으로 띄우라는 뜻 */
  onMarkerClick: (num: number, x: number, y: number) => void
  /** References 줄을 눌렀다 — 그 번호의 마커 자리로 가라는 뜻 */
  onEntryClick: (num: number) => void
}

export const footnoteKey = new PluginKey('mewFootnotes')

interface MarkerHit {
  from: number
  to: number
  num: number
}

interface EntryHit {
  /** 목록 항목(listItem) 노드의 시작 위치 */
  pos: number
  nodeSize: number
  /** 목록에서 몇 번째인가(1부터) — 이게 곧 그 각주의 번호다 */
  num: number
  content: string
}

interface Scan {
  markers: MarkerHit[]
  entries: EntryHit[]
  /** References의 순서 목록 — 없으면 null */
  list: { pos: number; nodeSize: number } | null
  /** References 제목 다음(목록이 들어갈) 위치 — 구역이 없으면 null */
  entriesStart: number | null
  /** 구역이 차지한 범위 — 마커를 셀 때 여기는 뺀다 */
  sectionFrom: number
  sectionTo: number
}

/** 문서에서 마커와 References 줄을 한 번에 훑는다 */
export function scanFootnotes(doc: PMNode): Scan {
  let sectionFrom = Infinity
  let sectionTo = Infinity
  let entriesStart: number | null = null
  const entries: EntryHit[] = []

  // References 제목을 찾고, 다음 제목(레벨 무관) 전까지를 그 구역으로 본다
  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return
    if (sectionFrom !== Infinity) {
      if (offset < sectionTo && offset > sectionFrom) sectionTo = offset
      return
    }
    if (REFERENCES_HEADING_RE.test(node.textContent)) {
      sectionFrom = offset
      entriesStart = offset + node.nodeSize
      sectionTo = Infinity
    }
  })
  if (sectionFrom !== Infinity && sectionTo === Infinity) sectionTo = doc.content.size

  // 구역 안의 첫 순서 목록이 참고문헌이다. 번호는 목록이 스스로 매기므로 우리가 글자로 적지 않는다
  let list: Scan['list'] = null
  if (entriesStart !== null) {
    doc.forEach((node, offset) => {
      if (list || offset < entriesStart! || offset >= sectionTo) return
      if (node.type.name !== 'orderedList') return
      list = { pos: offset, nodeSize: node.nodeSize }
      node.forEach((item, itemOffset) => {
        entries.push({
          // offset+1 = 목록 안쪽(첫 항목이 시작하는 자리)
          pos: offset + 1 + itemOffset,
          nodeSize: item.nodeSize,
          num: entries.length + 1,
          content: item.textContent,
        })
      })
    })
  }

  const markers: MarkerHit[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    if (pos >= sectionFrom && pos < sectionTo) return false // 참고문헌 안의 글자는 마커로 세지 않는다
    for (const match of node.text.matchAll(FOOTNOTE_MARKER_RE)) {
      const from = pos + (match.index ?? 0)
      markers.push({ from, to: from + match[0].length, num: fromSubscript(match[0]) })
    }
    return true
  })

  return { markers, entries, list, entriesStart, sectionFrom, sectionTo }
}

/** References 항목 앞의 `1)` — 이것만이 마커 자리로 가는 손잡이다 */
function entryNumber(num: number, onEntryClick: (num: number) => void): HTMLElement {
  const el = document.createElement('span')
  el.className = 'mew-footnote-ref'
  el.setAttribute('data-footnote-ref', String(num))
  el.contentEditable = 'false'
  el.textContent = `${num})`
  // 위젯이 목록의 들여쓰기 자리(li 바깥)에 떠 있어 PM의 좌표→위치 변환이 닿지 않는다 —
  // 클릭은 handleClick에 맡기지 않고 이 엘리먼트가 직접 받는다
  el.addEventListener('mousedown', (event) => {
    event.preventDefault()
    onEntryClick(num)
  })
  return el
}

/** 마커는 누를 수 있게, References 번호는 그 자리로 갈 수 있게 표시를 단다 */
function buildDecorations(doc: PMNode, onEntryClick: (num: number) => void): DecorationSet {
  const scan = scanFootnotes(doc)
  if (scan.markers.length === 0 && scan.entries.length === 0) return DecorationSet.empty
  const decos = [
    // 참고문헌 목록임을 CSS에 알린다 — 목록 자체 번호(::marker)는 끄고 아래 위젯이 `1)`을 그린다
    ...(scan.list ? [Decoration.node(scan.list.pos, scan.list.pos + scan.list.nodeSize, { class: 'mew-references' })] : []),
    ...scan.markers.map((m) => Decoration.inline(m.from, m.to, { class: 'mew-footnote', 'data-footnote': String(m.num) })),
    // 누르는 자리는 번호뿐이다 — 항목 본문은 평범한 글이고 그 안의 링크는 링크대로 눌린다.
    // ::marker는 히트 테스트 대상이 아니라 눌리지 않으므로 번호를 위젯으로 직접 그린다.
    // e.pos + 2 = listItem 안 첫 블록의 내용이 시작하는 자리
    ...scan.entries.map((e) =>
      Decoration.widget(e.pos + 2, () => entryNumber(e.num, onEntryClick), { side: -1, key: `fn-num-${e.num}` }),
    ),
  ]
  return DecorationSet.create(doc, decos)
}

/** 마커·번호가 이미 맞는지 — 맞으면 트랜잭션을 만들지 않는다(타이핑 중 커서가 튀지 않게) */
function inSync(scan: Scan, numbers: number[]): boolean {
  if (scan.markers.length !== numbers.length) return false
  // 항목 번호는 목록이 세므로 개수만 맞으면 된다 — 본문 마커 번호만 확인한다
  if (scan.entries.length !== numbers.length) return false
  return scan.markers.every((m, i) => m.num === numbers[i])
}

export const Footnotes = Extension.create<FootnoteOptions>({
  name: 'mewFootnotes',

  addOptions() {
    return { onMarkerClick: () => {}, onEntryClick: () => {} } satisfies FootnoteOptions
  },

  addKeyboardShortcuts() {
    return {
      'Alt-e': () => {
        const { state, dispatch } = this.editor.view
        const scan = scanFootnotes(state.doc)
        const num = nextMarkerNumber(
          scan.markers.map((m) => m.num),
          scan.entries.map((e) => ({ num: e.num, content: e.content })),
        )
        // 고른 글자가 있으면 그 **뒤**에 붙인다 — 지우고 그 자리에 넣으면 안 된다.
        // 아직 아무도 안 쓰는 번호로 넣고, 제자리 번호는 appendTransaction이 매긴다
        const at = state.selection.to
        dispatch(state.tr.insertText(markerFor(num), at, at).scrollIntoView())
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const { onMarkerClick, onEntryClick } = this.options
    return [
      new Plugin({
        key: footnoteKey,

        // 문서가 바뀔 때마다 번호를 맞춘다 — 같은 undo 단위에 붙어 사용자의 되돌리기 한 번에 함께 풀린다
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((tr) => tr.docChanged)) return null
          const scan = scanFootnotes(state.doc)
          if (scan.markers.length === 0) return null // 손으로 쓴 References를 지우지 않는다

          const plan = planFootnotes(
            scan.markers.map((m) => m.num),
            scan.entries.map((e) => ({ num: e.num, content: e.content })),
          )
          if (inSync(scan, plan.numbers)) return null

          const tr = state.tr
          const { paragraph, heading, orderedList, listItem } = state.schema.nodes
          if (!paragraph || !orderedList || !listItem) return null
          /** 빈 항목 하나 — 내용은 사람이 쓴다. 번호는 목록이 알아서 센다 */
          const emptyItem = () => listItem.create(null, paragraph.create())

          if (scan.entries.length === 0) {
            // 참고문헌 목록이 없다 — 제목(없으면 그것부터) 뒤에 목록을 통째로 만든다
            let at = scan.entriesStart
            if (at === null) {
              at = tr.doc.content.size
              if (heading) {
                const title = heading.create({ level: 1 }, state.schema.text('References'))
                tr.insert(at, title)
                at += title.nodeSize
              }
            }
            tr.insert(at, orderedList.create(null, plan.numbers.map(() => emptyItem())))
          } else {
            // 뒤에서 앞으로 고친다 — 앞을 먼저 건드리면 뒤 위치가 전부 밀린다.
            // 번호는 목록이 세므로 **끼우고 빼기만** 하면 된다(내용·링크는 손대지 않는다)
            const used = new Set(plan.sources.filter((s) => s >= 0))
            for (let i = scan.entries.length - 1; i >= 0; i--) {
              if (used.has(i)) continue
              const entry = scan.entries[i]
              tr.delete(tr.mapping.map(entry.pos), tr.mapping.map(entry.pos + entry.nodeSize))
            }
            for (let i = plan.numbers.length - 1; i >= 0; i--) {
              if (plan.sources[i] >= 0) continue
              const nextSource = plan.sources.slice(i + 1).find((s) => s >= 0)
              const last = scan.entries[scan.entries.length - 1]
              const anchor = nextSource === undefined ? last.pos + last.nodeSize : scan.entries[nextSource].pos
              // bias -1 — 앞서 끼운 항목보다 **앞**에 놓여야 연달아 넣은 각주 순서가 뒤집히지 않는다
              tr.insert(tr.mapping.map(anchor, -1), emptyItem())
            }
          }
          // 3) 본문 마커 번호 — 참고문헌보다 앞에 있으므로 맨 마지막에 고친다
          for (let i = scan.markers.length - 1; i >= 0; i--) {
            const marker = scan.markers[i]
            if (marker.num === plan.numbers[i]) continue
            tr.insertText(markerFor(plan.numbers[i]), tr.mapping.map(marker.from), tr.mapping.map(marker.to))
          }
          return tr.steps.length > 0 ? tr : null
        },

        // 장식은 문서가 바뀔 때만 다시 만든다 — 훑기가 문서 크기에 비례하므로 매 렌더마다 돌면 안 된다
        state: {
          init: (_config, state) => buildDecorations(state.doc, onEntryClick),
          apply: (tr, old, _oldState, newState) =>
            tr.docChanged ? buildDecorations(newState.doc, onEntryClick) : old,
        },

        props: {
          decorations(state) {
            return this.getState(state)
          },

          // 본문 마커만 여기서 받는다 — References 번호는 위젯이 직접 받는다(entryNumber)
          handleClick: (_view, _pos, event) => {
            const el = (event.target as HTMLElement | null)?.closest?.('[data-footnote]')
            if (!el) return false
            onMarkerClick(Number(el.getAttribute('data-footnote')), event.clientX, event.clientY)
            return true
          },
        },
      }),
    ]
  },
})
