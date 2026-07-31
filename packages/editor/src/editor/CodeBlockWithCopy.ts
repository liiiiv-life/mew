import CodeBlock from '@tiptap/extension-code-block'
import { Plugin, PluginKey } from '@tiptap/pm/state'

// 복사 버튼 아이콘 — 라벨 텍스트 대신 순수 아이콘만 노출한다. currentColor라 버튼 color를 따라간다.
const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'

// 클립보드 복사 — 보안 컨텍스트(https)에선 Clipboard API, 아니면 execCommand로 폴백.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Clipboard API가 막혀 있으면 아래 폴백으로 넘어간다
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// 코드블럭 우상단에 원클릭 복사 버튼을 붙인 CodeBlock.
// 편집 내용(code)은 ProseMirror가 contentDOM으로 관리하고, 버튼은 그 밖의 비편집 영역에 둔다.
// 복사 대상은 클릭 시점의 code.textContent이므로 편집 중에도 항상 최신 내용을 복사한다.
export const CodeBlockWithCopy = CodeBlock.extend({
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey('codeBlockPlainCopy'),
        props: {
          // 코드블럭 "안의 텍스트 일부"(혹은 전체)를 선택해 복사하면 tiptap-markdown이
          // ``` 펜스를 붙여 버린다. 그런 텍스트 선택은 열린 슬라이스(openStart/openEnd > 0)라
          // 여기서 가로채 순수 텍스트만 돌려준다. 코드블럭 노드 자체를 선택(NodeSelection)해
          // 복사할 때만 닫힌 슬라이스(경계 0)라 빈 문자열을 반환한다 → ProseMirror의 someProp이
          // falsy로 보고 다음 직렬화기(tiptap-markdown)로 넘겨 펜스를 붙인다.
          // CodeBlock 우선순위(100)가 markdown 확장(50)보다 높아 이 직렬화기가 먼저 평가된다.
          clipboardTextSerializer: (slice) => {
            const { content, openStart, openEnd } = slice
            if (content.childCount === 1 && openStart > 0 && openEnd > 0) {
              const only = content.firstChild
              if (only && only.type.name === this.name) return only.textContent
            }
            return ''
          },
        },
      }),
    ]
  },
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement('div')
      dom.className = 'code-block-wrap'

      const pre = document.createElement('pre')
      pre.className = typeof HTMLAttributes.class === 'string' ? HTMLAttributes.class : 'code-block'
      const code = document.createElement('code')
      const language = node.attrs.language as string | null
      if (language) code.className = `language-${language}`
      pre.appendChild(code)

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'code-block-copy'
      button.innerHTML = COPY_ICON
      button.title = '코드 복사'
      button.setAttribute('aria-label', '코드 복사')
      button.setAttribute('contenteditable', 'false')
      // 버튼을 눌러도 편집 커서가 옮겨가지 않게 한다
      button.addEventListener('mousedown', (e) => e.preventDefault())
      button.addEventListener('click', (e) => {
        e.preventDefault()
        // 복사 버튼은 항상 순수 코드 텍스트만 복사한다 (``` 펜스 없음)
        void copyText(code.textContent ?? '').then((ok) => {
          if (!ok) return
          button.innerHTML = CHECK_ICON
          button.classList.add('is-copied')
          window.setTimeout(() => {
            button.innerHTML = COPY_ICON
            button.classList.remove('is-copied')
          }, 1200)
        })
      })

      dom.appendChild(button)
      dom.appendChild(pre)

      return {
        dom,
        contentDOM: code,
        update: (updated) => updated.type.name === node.type.name,
        // 편집 대상(code) 밖에서 일어난 DOM 변경(복사 버튼 아이콘 등)은 ProseMirror가 무시하게 한다
        ignoreMutation: (mutation) =>
          !(mutation.target === code || code.contains(mutation.target as Node)),
        // 버튼에서 난 이벤트는 ProseMirror가 처리하지 않게 한다
        stopEvent: (event) => button.contains(event.target as Node),
      }
    }
  },
})
