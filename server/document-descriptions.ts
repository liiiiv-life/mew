import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'

/** Read only the YAML header; document bodies never enter the discovery catalog. */
export function readDescription(file: string): string {
  const fd = fs.openSync(file, 'r')
  let header = ''
  try {
    const chunk = Buffer.alloc(4096)
    while (true) {
      const size = fs.readSync(fd, chunk)
      if (!size) throw new Error('Missing frontmatter')
      header += chunk.subarray(0, size).toString('latin1')
      if (header.length >= 5 && !header.startsWith('---\n') && !header.startsWith('---\r\n')) throw new Error('Missing frontmatter')
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(header)
      if (!match) continue
      const yaml = parseDocument(Buffer.from(match[1], 'latin1').toString('utf8'))
      if (yaml.errors.length) throw new Error('Invalid frontmatter')
      const description = yaml.get('description')
      if (typeof description !== 'string' || !description.trim()) throw new Error('Missing description')
      if (yaml.has('desc')) throw new Error('Use description instead of desc')
      return description.trim().replace(/\s+/g, ' ')
    }
  } finally { fs.closeSync(fd) }
}

export function descriptionCatalog(root: string, includeHistory = false): { entries: [string, string][]; errors: string[] } {
  const entries: [string, string][] = [], errors: string[] = []
  function walk(dir: string) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name.startsWith('.') || item.name === 'archives' || !includeHistory && item.name === 'history') continue
      const file = path.join(dir, item.name)
      if (item.isDirectory()) walk(file)
      else if (item.isFile() && /\.md$/i.test(item.name)) {
        const relative = path.relative(root, file).split(path.sep).join('/')
        try { entries.push([relative, readDescription(file)]) }
        catch (error) { errors.push(`${relative}: ${error instanceof Error ? error.message : error}`) }
      }
    }
  }
  walk(root)
  return { entries, errors }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.on('error', error => {
    if ((error as NodeJS.ErrnoException).code === 'EPIPE') process.exit(0)
    throw error
  })
  const args = process.argv.slice(2)
  const result = descriptionCatalog(path.resolve(args.find(arg => !arg.startsWith('--')) ?? 'docs'), args.includes('--all'))
  for (const error of result.errors) process.stderr.write(`${error}\n`)
  if (args.includes('--check')) process.stdout.write(`${result.entries.length} descriptions, ${result.errors.length} errors\n`)
  else for (const [file, description] of result.entries) process.stdout.write(`${JSON.stringify(file)}\t${description}\n`)
  if (result.errors.length) process.exitCode = 1
}
