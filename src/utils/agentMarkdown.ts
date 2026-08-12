import MarkdownIt from 'markdown-it'

/**
 * 에이전트 답변을 그릴 마크다운 — 모델이 만든 글이므로 raw HTML은 끈다(html:false).
 * 그러면 `<script>` 같은 건 태그가 아니라 글자로 이스케이프돼 들어간다.
 * breaks:true — 채팅에서는 줄바꿈 하나가 그대로 줄바꿈이어야 말이 된다.
 * 에이전트 창과 에이전트셋 창이 같은 규칙으로 그려야 해서 여기 한 곳에 둔다.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
// 링크는 새 탭으로 — 창 안에서 열리면 돌아가던 세션 화면을 통째로 잃는다
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noreferrer noopener')
  return self.renderToken(tokens, idx, options)
}

/**
 * 같은 본문을 두 번 파싱하지 않는다 — 대화가 길어지면 상태가 하나 바뀔 때마다(meta·스크롤·읽음 표시)
 * 펼쳐 둔 버블 전부가 다시 그려지고, 그때마다 markdown-it이 같은 글을 처음부터 다시 읽는다.
 * ponytail: 200개 넘으면 통째로 비우는 단순 상한 — 문자열 키라 LRU가 필요할 만큼 크지 않다.
 */
const rendered = new Map<string, string>()

export function renderMarkdown(text: string): string {
  const hit = rendered.get(text)
  if (hit !== undefined) return hit
  const html = md.render(text)
  if (rendered.size > 200) rendered.clear()
  rendered.set(text, html)
  return html
}
