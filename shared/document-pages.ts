export type DocumentPageMove = { from: string; to: string; directory?: boolean }
export type DocumentPageMutation = { path: string; moves: DocumentPageMove[]; changed: string[]; removed?: { path: string; directory: boolean } }

export function representativeName(directory: string): string { return `_${directory.split('/').pop()}.md` }
export function pageRepresentative<T extends { name: string; type: string }>(directory: string, children: readonly T[]): T | undefined {
  const names = [representativeName(directory), '_MOC.md', 'MOC.md']
  for (const name of names) { const found = children.find(node => node.type === 'file' && node.name === name); if (found) return found }
}
export function documentPageTarget(file: string): string {
  const parts = file.split('/'), name = parts.pop()!, directory = parts.join('/')
  return name === representativeName(directory) || name === 'MOC.md' || name === '_MOC.md' ? directory : file
}
export function remapPagePath(path: string, moves: readonly DocumentPageMove[]): string {
  const move = [...moves].sort((a, b) => b.from.length - a.from.length).find(move => path === move.from || (move.directory && path.startsWith(`${move.from}/`)))
  return move ? move.to + path.slice(move.from.length) : path
}

function normalized(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}
function relative(from: string, to: string): string {
  const a = normalized(from).split('/').filter(Boolean), b = normalized(to).split('/').filter(Boolean)
  let i = 0; while (i < a.length && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/') || '.'
}
const parent = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

/** Preserve link destinations when pages move. Code/frontmatter and link labels stay intact. */
export function rewritePageLinks(content: string, oldPath: string, newPath: string, moves: readonly DocumentPageMove[]): string {
  const rewrite = (href: string, wiki = false): string => {
    if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return href
    const split = href.search(/[?#]/), suffix = split < 0 ? '' : href.slice(split), raw = split < 0 ? href : href.slice(0, split)
    let decoded: string; try { decoded = decodeURIComponent(raw.replace(/\\([ ()])/g, '$1')) } catch { return href }
    const absolute = raw.startsWith('/')
    let target = normalized(absolute ? decoded.slice(1) : `${parent(oldPath)}/${decoded}`)
    if (wiki && !absolute) {
      const candidates = [target, `${target}.md`, normalized(decoded), `${normalized(decoded)}.md`]
      const moved = candidates.find(candidate => remapPagePath(candidate, moves) !== candidate)
      if (moved) target = moved
      else if (!decoded.includes('/')) return href // An unchanged vault-wide page name remains valid after moving its source.
    }
    let moved = remapPagePath(target, moves)
    const extensionless = !/\.[^/]+$/.test(target)
    if (moved === target && extensionless) {
      const candidate = remapPagePath(`${target}.md`, moves)
      if (candidate !== `${target}.md`) moved = candidate
    }
    if (moved === target && parent(oldPath) === parent(newPath)) return href
    let result = absolute ? `/${moved}` : relative(parent(newPath), moved)
    if (extensionless && result.endsWith('.md')) result = result.slice(0, -3)
    return encodeURI(result).replace(/#/g, '%23').replace(/\?/g, '%3F') + suffix
  }
  // Mask ranges before replacing targets, then restore byte-for-byte.
  const masks: string[] = []
  let marker = '\uE000PAGE'
  while (content.includes(marker)) marker += 'P'
  const mask = (text: string) => { const key = `${marker}${masks.length}\uE001`; masks.push(text); return key }
  let text = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, mask)
  text = text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*(?:\n|$)/gm, mask)
  text = text.replace(/^(?: {4}|\t).*$/gm, mask).replace(/(`+)([^`]|(?!\1)`)*?\1/g, mask)
  text = text.replace(/(?<!\\)(!?\[[^\]\n]*\]\(\s*)(?:<([^>\n]+)>|((?:\\.|[^()\s]|\([^()]*\))+))/g,
    (_match, prefix: string, angle: string | undefined, bare: string | undefined) => prefix + (angle !== undefined ? `<${rewrite(angle)}>` : rewrite(bare!)))
  text = text.replace(/^( {0,3}\[[^\]\n]+\]:\s*)(?:<([^>\n]+)>|(\S+))/gm,
    (_match, prefix: string, angle: string | undefined, bare: string | undefined) => prefix + (angle !== undefined ? `<${rewrite(angle)}>` : rewrite(bare!)))
  text = text.replace(/(?<![\\!])\[\[([^\]\n|]+)(\|[^\]\n]*)?\]\]/g,
    (_match, target: string, alias: string | undefined) => `[[${rewrite(target, true)}${alias ?? ''}]]`)
  return text.replace(new RegExp(`${marker}(\\d+)\uE001`, 'g'), (_match, index: string) => masks[Number(index)])
}
