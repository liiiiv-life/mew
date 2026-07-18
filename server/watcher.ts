import fs from 'node:fs'
import { DOCS_ROOT } from './paths'
import { buildTree } from './tree'
import { broadcast } from './presence'

const IGNORE_RE = /(^|\/)(\.git|node_modules|\.foam|\.github|\.obsidian|\.tokensave|\.vscode)(\/|$)/

let started = false
let lastTreeJson = ''
let timer: NodeJS.Timeout | null = null

// 다른 세션·에이전트·터미널이 만든 파일도 사이드바에 바로 반영되도록 docs 루트를 감시한다.
// 본문 저장(내용만 변경)도 watch 이벤트를 발생시키므로, 트리 JSON이 실제로 달라졌을 때만
// 브로드캐스트해서 편집 중 불필요한 refetch를 막는다.
export function watchDocsTree() {
  if (started) return
  started = true
  lastTreeJson = JSON.stringify(buildTree())
  fs.watch(DOCS_ROOT, { recursive: true }, (_event, filename) => {
    if (filename && IGNORE_RE.test(filename)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      let json: string
      try {
        json = JSON.stringify(buildTree())
      } catch {
        // 삭제·이동 도중의 일시적 상태는 다음 이벤트에서 따라잡는다
        return
      }
      if (json === lastTreeJson) return
      lastTreeJson = json
      broadcast({ type: 'tree' })
    }, 300)
  })
}
