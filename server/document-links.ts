import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

function localLinks(source: string): string[] {
  const links: string[] = []
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)
  if (frontmatter) {
    const parent = parseDocument(frontmatter[1]).get('상위파일')
    if (typeof parent === 'string') links.push(parent)
    else if (Array.isArray(parent)) links.push(...parent.filter((value): value is string => typeof value === 'string'))
    else if (parent && typeof parent === 'object' && 'toJSON' in parent) {
      const values: unknown = (parent as { toJSON(): unknown }).toJSON()
      if (Array.isArray(values)) links.push(...values.filter((value): value is string => typeof value === 'string'))
    }
    source = source.slice(frontmatter[0].length)
  }
  let fence: { character: string; length: number } | null = null
  source = source.split('\n').map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (marker && marker[0] === fence.character && marker.length >= fence.length) fence = null
      return ''
    }
    if (marker) { fence = { character: marker[0], length: marker.length }; return '' }
    return line
  }).join('\n').replace(/(`+)[\s\S]*?\1/g, '').replace(/<!--[\s\S]*?-->/g, '')
  for (const match of source.matchAll(/\]\((<[^>\n]+>|[^)\n]+)\)/g)) {
    links.push(match[1].trim().replace(/\s+["'][^"']*["']$/, '').replace(/^<|>$/g, ''))
  }
  for (const match of source.matchAll(/^ {0,3}\[(?!\^)[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm)) {
    links.push(match[1].replace(/^<|>$/g, ''))
  }
  return links
}

export function documentLinkErrors(root: string, includeHistory = false): string[] {
  root = fs.realpathSync(root)
  const files = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'SECURITY.md'].map(name => path.join(root, name)).filter(file => fs.existsSync(file))
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'archives' || !includeHistory && entry.name === 'history') continue
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile() && /\.md$/i.test(entry.name)) files.push(file)
    }
  }
  if (fs.existsSync(path.join(root, 'docs'))) walk(path.join(root, 'docs'))
  const errors: string[] = []
  for (const file of files) {
    for (const href of localLinks(fs.readFileSync(file, 'utf8'))) {
      if (!href || href.startsWith('#') || href.startsWith('//')) continue
      const label = `${path.relative(root, file).split(path.sep).join('/')}: ${href}`
      if (/^file:/i.test(href) || path.isAbsolute(href) || path.win32.isAbsolute(href)) {
        errors.push(`${label}: use a repository-relative path`)
        continue
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue
      let target: string
      try { target = decodeURIComponent(href.split(/[?#]/, 1)[0]) }
      catch { errors.push(`${label}: invalid URL encoding`); continue }
      if (!target) continue
      const resolved = path.resolve(path.dirname(file), target)
      if (!inside(root, resolved)) errors.push(`${label}: outside repository`)
      else if (!fs.existsSync(resolved)) errors.push(`${label}: missing target`)
      else if (!inside(root, fs.realpathSync(resolved))) errors.push(`${label}: symlink target outside repository`)
    }
  }
  return [...new Set(errors)].sort()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const errors = documentLinkErrors(path.resolve(args.find(arg => !arg.startsWith('--')) ?? '.'), args.includes('--all'))
  for (const error of errors) process.stderr.write(`${error}\n`)
  process.stdout.write(`${errors.length} document link errors\n`)
  if (errors.length) process.exitCode = 1
}
