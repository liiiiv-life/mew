import { uiText, getUiLocale } from '@mew/ui/i18n-core'
import MarkdownIt from 'markdown-it'

/**
 * 에이전트 답변을 그릴 마크다운 — 모델이 만든 글이므로 raw HTML은 끈다(html:false).
 * 그러면 `<script>` 같은 건 태그가 아니라 글자로 이스케이프돼 들어간다.
 * breaks:true — 채팅에서는 줄바꿈 하나가 그대로 줄바꿈이어야 말이 된다.
 * 에이전트 창의 답변을 한 규칙으로 그린다.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
const fence = md.renderer.rules.fence
const codeBlock = md.renderer.rules.code_block

function attr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function copyButton(text: string, label: string): string {
  return `<button type="button" class="mew-agent-copy-button" data-mew-copy="${attr(text)}" title="${label}" aria-label="${label}">
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect width="13" height="13" x="9" y="9" rx="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  </button>`
}

// 외부 링크는 새 탭으로 연다. 워크스페이스 파일 링크는 말풍선 클릭 핸들러가 기본 동작을 막고
// App의 프로젝트 전환·문서 탭 열기로 보낸다.
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noreferrer noopener')
  return self.renderToken(tokens, idx, options)
}
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const rendered = fence
    ? fence(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options)
  return `<div class="mew-agent-code-copy">${copyButton(tokens[idx].content, uiText("코드 복사", undefined, env.locale))}${rendered}</div>`
}
md.renderer.rules.code_block = (tokens, idx, options, _env, self) =>
  `<div class="mew-agent-code-copy">${copyButton(tokens[idx].content, uiText("코드 복사", undefined, _env.locale))}${
    codeBlock ? codeBlock(tokens, idx, options, _env, self) : `<pre><code>${md.utils.escapeHtml(tokens[idx].content)}</code></pre>`
  }</div>`
md.renderer.rules.table_open = (tokens, idx, options, env: { source?: string; lines?: string[]; locale?: ReturnType<typeof getUiLocale> }, self) => {
  const range = tokens[idx].map
  const source = env.source && range ? (env.lines ??= env.source.split('\n')).slice(range[0], range[1]).join('\n') : ''
  return `<div class="mew-agent-table-scroll">${copyButton(source, uiText("표 복사", undefined, env.locale))}${self.renderToken(tokens, idx, options)}`
}
md.renderer.rules.table_close = (tokens, idx, options, _env, self) =>
  `${self.renderToken(tokens, idx, options)}</div>`

export function copyTextFromAgentMarkdownClick(target: EventTarget | null): string | null {
  const button = target instanceof Element ? target.closest<HTMLButtonElement>('button[data-mew-copy]') : null
  return button?.dataset.mewCopy ?? null
}

export function agentMarkdownHrefFromClick(target: EventTarget | null): string | null {
  const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
  return anchor?.getAttribute('href') ?? null
}

/** 웹·메일·페이지 앵커는 브라우저에 맡기고, 경로처럼 생긴 링크만 서버의 워크스페이스 해석기로 보낸다. */
export function isAgentWorkspaceHref(href: string): boolean {
  if (/^file:/i.test(href)) return true
  return !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)
}

export function markAgentMarkdownCopied(target: EventTarget | null) {
  const button = target instanceof Element ? target.closest<HTMLButtonElement>('button[data-mew-copy]') : null
  if (!button) return
  button.dataset.copied = '1'
  button.title = uiText("복사됨")
  button.setAttribute('aria-label', uiText("복사됨"))
  window.setTimeout(() => {
    delete button.dataset.copied
    const label = button.closest('.mew-agent-table-scroll') ? uiText("표 복사") : uiText("코드 복사")
    button.title = label
    button.setAttribute('aria-label', label)
  }, 900)
}

/**
 * 같은 본문을 두 번 파싱하지 않는다 — 대화가 길어지면 상태가 하나 바뀔 때마다(meta·스크롤·읽음 표시)
 * 펼쳐 둔 버블 전부가 다시 그려지고, 그때마다 markdown-it이 같은 글을 처음부터 다시 읽는다.
 * Cache only bounded entries and evict the least recently used, preserving hot older answers.
 */
const rendered = new Map<string, { html: string; bytes: number }>()
const MAX_RENDERED_BYTES = 4 * 1024 * 1024
const MAX_RENDERED_ENTRY_BYTES = 512 * 1024
let renderedBytes = 0

export function renderMarkdown(text: string, locale = getUiLocale()): string {
  const key = `${locale}\0${text}`
  const hit = rendered.get(key)
  if (hit !== undefined) {
    rendered.delete(key)
    rendered.set(key, hit)
    return hit.html
  }
  const html = md.render(text, { source: text, locale })
  const bytes = (key.length + html.length) * 2
  if (bytes > MAX_RENDERED_ENTRY_BYTES) return html
  while (rendered.size >= 128 || renderedBytes + bytes > MAX_RENDERED_BYTES) {
    const oldest = rendered.keys().next().value!
    renderedBytes -= rendered.get(oldest)!.bytes
    rendered.delete(oldest)
  }
  rendered.set(key, { html, bytes })
  renderedBytes += bytes
  return html
}
