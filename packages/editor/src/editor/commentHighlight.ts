import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { resolveCommentAnchor, type CommentAnchor } from '../utils/commentAnchor.ts'

// 댓글 하이라이트 — 본문에는 아무 마크도 넣지 않는 **장식(decoration)**이다. 마크로 넣으면
// 마크다운 직렬화·협업 병합에 섞여 들어가므로 절대 마크로 바꾸지 말 것. 앵커는 텍스트 문맥
// (commentAnchor.ts)이고, 문서가 바뀔 때마다 다시 푼다.

export interface CommentThreadInput {
  id: string
  anchor: CommentAnchor
}

export interface CommentHighlightOptions {
  /** 지금 스레드 목록 — 호스트가 ref로 넘긴다(옵션은 에디터 생성 시 한 번 잡히므로 getter여야 한다) */
  getThreads: () => CommentThreadInput[]
  onClick: (id: string, x: number, y: number) => void
}

/** 스레드 목록이 바뀌었을 때 tr.setMeta(commentRefreshKey, true)로 다시 그리게 한다 */
export const commentRefreshKey = new PluginKey('mewCommentHighlight')

/**
 * 렌더된 문서의 텍스트와 인덱스→PM 위치 대응표. 블록 경계는 '\n' 하나로 잇는다 —
 * plain 모드의 줄 감각과 비슷해야 앵커의 line 힌트가 양쪽에서 그럭저럭 통한다.
 * map[i] = text[i]에 해당하는 PM 위치, 마지막 원소는 문서 끝.
 */
export function docTextWithMap(doc: PMNode): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  let firstBlock = true
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (!firstBlock) {
        text += '\n'
        map.push(pos)
      }
      firstBlock = false
    }
    if (node.isText && node.text) {
      // descendants가 주는 pos는 **그 노드 바로 앞**이고, 텍스트 노드에서는 그것이 곧 첫 글자의 자리다
      // (+1을 더하면 하이라이트가 통째로 한 글자씩 밀린다 — commentHighlight.test.ts가 이걸 잡는다)
      for (let i = 0; i < node.text.length; i++) map.push(pos + i)
      text += node.text
    }
    return true
  })
  map.push(doc.content.size)
  return { text, map }
}

/** PM 위치 → 텍스트 인덱스 (map에서 이분 탐색 — pos 이상이 처음 나오는 자리) */
export function indexOfPos(map: number[], pos: number): number {
  let lo = 0
  let hi = map.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (map[mid] < pos) lo = mid + 1
    else hi = mid
  }
  return lo
}

function buildDecorations(doc: PMNode, threads: CommentThreadInput[]): DecorationSet {
  if (threads.length === 0) return DecorationSet.empty
  // ponytail: 문서 전체 텍스트를 매번 다시 뽑는다(변경마다 O(문서 크기)) — 큰 문서에서 느려지면 디바운스로
  const { text, map } = docTextWithMap(doc)
  const decos: Decoration[] = []
  for (const thread of threads) {
    const range = resolveCommentAnchor(text, thread.anchor)
    if (!range) continue // 고아 — 목록 팝업에서만 보인다
    const from = map[range.from]
    const to = (map[range.to - 1] ?? doc.content.size - 1) + 1
    if (from == null || to <= from) continue
    decos.push(Decoration.inline(from, to, { class: 'mew-comment', 'data-thread': thread.id }))
  }
  return DecorationSet.create(doc, decos)
}

export const CommentHighlight = Extension.create<CommentHighlightOptions>({
  name: 'mewCommentHighlight',

  addOptions() {
    return { getThreads: () => [], onClick: () => {} } satisfies CommentHighlightOptions
  },

  addProseMirrorPlugins() {
    const { getThreads, onClick } = this.options
    return [
      new Plugin({
        key: commentRefreshKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc, getThreads()),
          apply: (tr, old, _oldState, newState) =>
            tr.docChanged || tr.getMeta(commentRefreshKey) ? buildDecorations(newState.doc, getThreads()) : old,
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
          // 하이라이트를 누르면 스레드 팝업 — 좌표는 팝업을 그 자리에 띄우기 위한 것
          handleClick: (_view, _pos, event) => {
            const el = (event.target as HTMLElement | null)?.closest?.('[data-thread]')
            const id = el?.getAttribute('data-thread')
            if (!id) return false
            onClick(id, event.clientX, event.clientY)
            return true
          },
        },
      }),
    ]
  },
})
