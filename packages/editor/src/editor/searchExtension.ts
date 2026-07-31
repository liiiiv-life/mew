import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

// VSCode식 문서 내 찾기·바꾸기 — 정규식/대소문자 옵션과 매치 하이라이트를 ProseMirror 데코레이션으로 그린다.
// 상태(검색어·옵션·매치 결과·현재 인덱스)는 확장 storage에 두고, 커맨드가 이를 갱신한 뒤 meta를 실은
// 빈 트랜잭션을 디스패치하면 아래 플러그인 apply가 문서를 다시 훑어 데코레이션을 재계산한다.

export interface SearchResult {
  from: number
  to: number
}

export interface SearchStorage {
  query: string
  replace: string
  caseSensitive: boolean
  regex: boolean
  results: SearchResult[]
  index: number
  /** 정규식이 잘못됐을 때의 에러 메시지 — 검색창에 붉게 표시한다 */
  error: string | null
}

export const searchPluginKey = new PluginKey<DecorationSet>('searchAndReplace')

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** storage의 검색어·옵션으로 문서를 훑어 매치 위치를 채우고, 하이라이트 데코레이션 집합을 만든다.
 * 텍스트블록 단위로 텍스트를 모아 매치가 블록 경계를 넘지 않게 한다 (넘으면 replace가 구조를 깬다). */
function buildDecorations(doc: PMNode, storage: SearchStorage): DecorationSet {
  const results: SearchResult[] = []
  storage.results = results
  const { query } = storage
  if (!query) {
    storage.error = null
    storage.index = 0
    return DecorationSet.empty
  }

  let regex: RegExp
  try {
    const flags = storage.caseSensitive ? 'g' : 'gi'
    regex = new RegExp(storage.regex ? query : escapeRegExp(query), flags)
    storage.error = null
  } catch (err) {
    storage.error = err instanceof Error ? err.message : '잘못된 정규식'
    return DecorationSet.empty
  }

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // 이 블록의 인라인 텍스트만 이어 붙이고, 각 문자가 문서 어디에 있는지 위치를 함께 기록한다.
    // (인라인 이미지·하드브레이크 같은 비텍스트 노드는 문자를 만들지 않지만 위치는 차지한다.)
    let text = ''
    const map: number[] = []
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) {
          text += child.text[i]
          map.push(pos + 1 + offset + i)
        }
      }
    })
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++
        continue
      }
      const from = map[match.index]
      const to = map[match.index + match[0].length - 1] + 1
      results.push({ from, to })
    }
    return false // 텍스트블록의 인라인 자식으로는 더 내려가지 않는다
  })

  if (storage.index >= results.length) storage.index = results.length ? results.length - 1 : 0

  const decorations = results.map((r, i) =>
    Decoration.inline(r.from, r.to, {
      class: i === storage.index ? 'search-match search-match-current' : 'search-match',
    }),
  )
  return DecorationSet.create(doc, decorations)
}

/** 한 건의 매치 텍스트에 대한 치환 결과 — 정규식 모드면 $1 등 캡처 그룹 확장을 지원한다. */
function computeReplacement(matched: string, storage: SearchStorage): string {
  if (!storage.regex) return storage.replace
  try {
    const flags = storage.caseSensitive ? '' : 'i'
    return matched.replace(new RegExp(storage.query, flags), storage.replace)
  } catch {
    return storage.replace
  }
}

declare module '@tiptap/core' {
  interface Storage {
    searchAndReplace: SearchStorage
  }
  interface Commands<ReturnType> {
    searchAndReplace: {
      setSearchQuery: (query: string) => ReturnType
      setSearchOptions: (opts: { caseSensitive?: boolean; regex?: boolean }) => ReturnType
      setReplaceTerm: (replace: string) => ReturnType
      /** 지정 인덱스 매치를 선택·스크롤한다 (i는 결과 길이로 클램프) */
      gotoSearchResult: (index: number) => ReturnType
      findNextResult: () => ReturnType
      findPrevResult: () => ReturnType
      replaceCurrentResult: () => ReturnType
      replaceAllResults: () => ReturnType
      clearSearch: () => ReturnType
    }
  }
}

export const SearchAndReplace = Extension.create<Record<string, never>, SearchStorage>({
  name: 'searchAndReplace',

  addStorage() {
    return { query: '', replace: '', caseSensitive: false, regex: false, results: [], index: 0, error: null }
  },

  addCommands() {
    const store = () => this.editor.storage.searchAndReplace as SearchStorage
    const bump = (dispatch: ((tr: unknown) => void) | undefined, tr: { setMeta: (k: unknown, v: unknown) => unknown }) => {
      if (dispatch) dispatch(tr.setMeta(searchPluginKey, true))
      return true
    }
    const goto = (index: number, state: { tr: any; doc: any }, dispatch: ((tr: unknown) => void) | undefined): boolean => {
      const s = store()
      if (!s.results.length) return false
      const clamped = ((index % s.results.length) + s.results.length) % s.results.length
      s.index = clamped
      const r = s.results[clamped]
      if (dispatch) {
        const tr = state.tr
        tr.setSelection(TextSelection.create(tr.doc, r.from, r.to))
        tr.scrollIntoView()
        dispatch(tr.setMeta(searchPluginKey, true))
      }
      return true
    }

    return {
      setSearchQuery:
        (query: string) =>
        ({ tr, dispatch }: any) => {
          const s = store()
          s.query = query
          s.index = 0
          return bump(dispatch, tr)
        },
      setSearchOptions:
        (opts: { caseSensitive?: boolean; regex?: boolean }) =>
        ({ tr, dispatch }: any) => {
          const s = store()
          if (opts.caseSensitive !== undefined) s.caseSensitive = opts.caseSensitive
          if (opts.regex !== undefined) s.regex = opts.regex
          return bump(dispatch, tr)
        },
      setReplaceTerm:
        (replace: string) =>
        () => {
          store().replace = replace
          return true
        },
      gotoSearchResult:
        (index: number) =>
        ({ state, dispatch }: any) =>
          goto(index, state, dispatch),
      findNextResult:
        () =>
        ({ state, dispatch }: any) =>
          goto(store().index + 1, state, dispatch),
      findPrevResult:
        () =>
        ({ state, dispatch }: any) =>
          goto(store().index - 1, state, dispatch),
      replaceCurrentResult:
        () =>
        ({ state, dispatch }: any) => {
          const s = store()
          if (!s.results.length) return false
          const idx = Math.min(s.index, s.results.length - 1)
          const r = s.results[idx]
          const replacement = computeReplacement(state.doc.textBetween(r.from, r.to), s)
          if (dispatch) {
            const tr = state.tr
            tr.insertText(replacement, r.from, r.to)
            dispatch(tr.setMeta(searchPluginKey, true))
          }
          return true
        },
      replaceAllResults:
        () =>
        ({ state, dispatch }: any) => {
          const s = store()
          if (!s.results.length) return false
          if (dispatch) {
            const tr = state.tr
            // 뒤에서 앞으로 치환해야 앞선 매치 좌표가 밀리지 않는다
            for (let i = s.results.length - 1; i >= 0; i--) {
              const r = s.results[i]
              const replacement = computeReplacement(state.doc.textBetween(r.from, r.to), s)
              tr.insertText(replacement, r.from, r.to)
            }
            dispatch(tr.setMeta(searchPluginKey, true))
          }
          return true
        },
      clearSearch:
        () =>
        ({ tr, dispatch }: any) => {
          const s = store()
          s.query = ''
          s.results = []
          s.index = 0
          s.error = null
          return bump(dispatch, tr)
        },
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin<DecorationSet>({
        key: searchPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            if (!tr.docChanged && !tr.getMeta(searchPluginKey)) {
              return old.map(tr.mapping, tr.doc)
            }
            return buildDecorations(tr.doc, storage)
          },
        },
        props: {
          decorations(state) {
            return searchPluginKey.getState(state)
          },
        },
      }),
    ]
  },
})
