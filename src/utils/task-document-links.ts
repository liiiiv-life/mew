export function taskDocumentLink(path: string): string {
  const label = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '').replace(/[\]\\[]/g, '\\$&')
  const href = encodeURI(path).replace(/[()#?]/g, char => '%' + char.charCodeAt(0).toString(16))
  return `[${label}](${href}) `
}

export function taskDocumentLinks(text: string): { label: string; path: string }[] {
  const links: { label: string; path: string }[] = []
  for (const match of text.matchAll(/\[((?:\\.|[^\]\\])+)\]\(([^\s)]+)\)/g)) {
    try {
      const path = decodeURIComponent(match[2])
      if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(path)) continue
      links.push({ label: match[1].replace(/\\([\]\\[])/g, '$1'), path })
    } catch { /* Malformed URLs stay editable as text. */ }
  }
  return links
}
