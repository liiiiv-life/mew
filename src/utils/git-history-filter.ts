import type { GitLogEntry } from '../api/client'
import { wildcardMatches } from './git-change-filter.ts'

export function filterGitHistory(commits: GitLogEntry[], query: string): GitLogEntry[] {
  const pattern = query.trim().toLowerCase()
  if (!pattern) return commits
  const wildcard = /[*?]/.test(pattern)
  const tokens = Array.from(pattern)
  const matches = (value: string) => wildcard
    ? wildcardMatches(value.toLowerCase(), tokens)
    : value.toLowerCase().includes(pattern)
  return commits.filter(commit => [commit.subject, commit.author, commit.hash, ...commit.refs].some(matches))
}
