import type { GitChangedFile } from '../api/client'

export function wildcardMatches(value: string, pattern: readonly string[]): boolean {
  const characters = Array.from(value)
  let index = 0
  let token = 0
  let star = -1
  let retry = 0
  while (index < characters.length) {
    if (pattern[token] === '?' || pattern[token] === characters[index]) {
      index++
      token++
    } else if (pattern[token] === '*') {
      star = token++
      retry = index
    } else if (star !== -1) {
      token = star + 1
      index = ++retry
    } else return false
  }
  while (pattern[token] === '*') token++
  return token === pattern.length
}

export function filterGitChanges(files: GitChangedFile[], query: string): GitChangedFile[] {
  const pattern = query.trim().toLowerCase()
  if (!pattern) return files
  const wildcard = /[*?]/.test(pattern)
  const tokens = Array.from(pattern)
  const matches = (path: string) => {
    const normalized = path.toLowerCase()
    return wildcard
      ? wildcardMatches(normalized, tokens) || wildcardMatches(normalized.slice(normalized.lastIndexOf('/') + 1), tokens)
      : normalized.includes(pattern)
  }
  return files.filter(file => matches(file.path) || (!!file.previousPath && matches(file.previousPath)))
}
