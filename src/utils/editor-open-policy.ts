import { mediaKind } from './media.ts'
import { editorFile } from './editor-files.ts'
import { externalAbsolutePath } from './externalFiles.ts'
import { gitDiffTarget } from './git-diff-tabs.ts'

const TEXT_EXTENSIONS = new Set([
  'md', 'mdx', 'markdown', 'txt', 'text', 'log', 'rst', 'adoc',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
  'json', 'jsonc', 'jsonl', 'ndjson', 'yml', 'yaml', 'toml', 'ini', 'conf', 'config', 'properties',
  'css', 'scss', 'sass', 'less', 'html', 'htm', 'svg', 'xml', 'xsl', 'vue', 'svelte',
  'sh', 'zsh', 'bash', 'fish', 'ps1', 'bat', 'cmd', 'py', 'pyi', 'sql', 'rs', 'go',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'java', 'kt', 'kts', 'swift', 'm', 'mm',
  'rb', 'php', 'pl', 'pm', 'lua', 'r', 'jl', 'dart', 'ex', 'exs', 'erl', 'hrl',
  'hs', 'lhs', 'clj', 'cljs', 'cljc', 'edn', 'scala', 'sc', 'fs', 'fsx', 'vb',
  'graphql', 'gql', 'proto', 'prisma', 'tf', 'tfvars', 'hcl', 'cmake', 'gradle',
  'lock', 'patch', 'diff', 'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'nvmrc',
])
const TEXT_NAMES = new Set([
  'readme', 'license', 'licence', 'copying', 'notice', 'authors', 'changelog',
  'dockerfile', 'containerfile', 'makefile', 'gnumakefile', 'gemfile', 'rakefile',
  'procfile', 'justfile', 'jenkinsfile', '.gitignore', '.gitattributes', '.editorconfig',
  '.npmrc', '.nvmrc', '.bashrc', '.zshrc', '.profile', '.bash_profile',
])

/** Decide before creating a tab or reading/caching its body. Unknown formats stay in the file explorer. */
export function canOpenEditorFile(tabPath: string): boolean {
  if (gitDiffTarget(tabPath)) return true
  const path = externalAbsolutePath(editorFile(tabPath).path)
  const kind = mediaKind(path)
  if (kind) return kind !== 'download'
  const name = (path.split('/').pop() ?? '').toLowerCase()
  if (TEXT_NAMES.has(name) || name === '.env' || name.startsWith('.env.') || name.startsWith('dockerfile.')) return true
  const dot = name.lastIndexOf('.')
  return dot >= 0 && TEXT_EXTENSIONS.has(name.slice(dot + 1))
}
