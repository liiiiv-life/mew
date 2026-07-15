export function htmlToMarkdown(html: string): string {
  if (html === '<p></p>' || html === '') return ''
  
  // 임시 DOM 파서
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  
  function processNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || ''
    }
    
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return ''
    }
    
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    const children = Array.from(el.childNodes).map(processNode).join('')
    
    switch (tag) {
      case 'p':
        return children + '\n\n'
      case 'h1':
        return `# ${children}\n\n`
      case 'h2':
        return `## ${children}\n\n`
      case 'h3':
        return `### ${children}\n\n`
      case 'h4':
        return `#### ${children}\n\n`
      case 'h5':
        return `##### ${children}\n\n`
      case 'h6':
        return `###### ${children}\n\n`
      case 'strong':
      case 'b':
        return `**${children}**`
      case 'em':
      case 'i':
        return `*${children}*`
      case 'del':
      case 's':
        return `~~${children}~~`
      case 'code':
        return `\`${children}\``
      case 'pre': {
        const code = el.querySelector('code')
        const content = code ? code.textContent || '' : children
        return `\`\`\`\n${content}\n\`\`\`\n\n`
      }
      case 'blockquote':
        return children.split('\n').map(line => line ? `> ${line}` : '').join('\n') + '\n\n'
      case 'ul':
        return children + '\n'
      case 'ol':
        return children + '\n'
      case 'li': {
        const parent = el.parentElement
        if (parent?.tagName.toLowerCase() === 'ol') {
          const index = Array.from(parent.children).indexOf(el) + 1
          return `${index}. ${children}\n`
        }
        return `- ${children}\n`
      }
      case 'hr':
        return '---\n\n'
      case 'a': {
        const href = el.getAttribute('href') || ''
        return `[${children}](${href})`
      }
      case 'img': {
        const src = el.getAttribute('src') || ''
        const alt = el.getAttribute('alt') || ''
        return `![${alt}](${src})`
      }
      case 'br':
        return '\n'
      default:
        return children
    }
  }
  
  const result = processNode(doc.body).trim()
  return result
}

export function markdownToHtml(markdown: string): string {
  if (!markdown) return '<p></p>'
  
  let html = markdown
  // 코드 블록 (가장 먼저 처리)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`
  })
  
  // 인라인 코드
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  
  // 헤딩
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  
  // 수평선
  html = html.replace(/^---$/gm, '<hr>')
  
  // 블록쿼트
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
  
  // 볼드
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  
  // 이탤릭
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  
  // 취소선
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')
  
  // 리스트 (간단한 처리)
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  
  // 링크
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  
  // 이미지
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
  
  // 줄바꿈을 단락으로
  html = html.replace(/\n\n+/g, '</p><p>')
  html = '<p>' + html + '</p>'
  
  // 빈 단락 제거
  html = html.replace(/<p><\/p>/g, '')
  
  return html
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
