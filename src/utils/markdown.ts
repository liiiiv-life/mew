export function markdownToHtml(markdown: string): string {
  let html = markdown
  
  // 코드 블록 (```language\ncode```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langAttr = lang ? ` class="language-${lang}"` : ''
    return `<pre><code${langAttr}>${escapeHtml(code.trim())}</code></pre>`
  })
  
  // 인라인 코드
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  
  // 제목 (h1~h6)
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  
  // 수평선
  html = html.replace(/^---+$/gm, '<hr>')
  
  // 인용구 (여러 줄 처리)
  html = html.replace(/(?:^> (.+)(?:\n|$))+/gm, (match) => {
    const content = match.replace(/^> /gm, '').trim()
    return `<blockquote><p>${content}</p></blockquote>`
  })
  
  // 정렬 리스트
  html = html.replace(/(?:^\d+\. (.+)(?:\n|$))+/gm, (match) => {
    const items = match.trim().split('\n').map(line => {
      return `<li>${line.replace(/^\d+\. /, '')}</li>`
    }).join('')
    return `<ol>${items}</ol>`
  })
  
  // 비정렬 리스트
  html = html.replace(/(?:^[-*+] (.+)(?:\n|$))+/gm, (match) => {
    const items = match.trim().split('\n').map(line => {
      return `<li>${line.replace(/^[-*+] /, '')}</li>`
    }).join('')
    return `<ul>${items}</ul>`
  })
  
  // 이미지
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
  
  // 링크
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  
  // 볼드
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  
  // 이탤릭
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  
  // 취소선
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')
  
  // 빈 줄을 단락으로 변환
  html = html.replace(/\n\n+/g, '</p><p>')
  
  // 남아있는 줄바꿈 제거
  html = html.replace(/\n/g, ' ')
  
  // 단락 래핑
  if (!html.startsWith('<h') && !html.startsWith('<p') && !html.startsWith('<ul') && !html.startsWith('<ol') && !html.startsWith('<pre')) {
    html = `<p>${html}</p>`
  }
  
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
