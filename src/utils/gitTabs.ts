const PREFIX = 'mew:git:'

/** Git 워크벤치는 파일 탭과 같은 수명주기를 쓰되 파일 API에는 보내지 않는 가상 경로다. */
export function gitTabPath(repositoryPath: string): string {
  return `${PREFIX}${encodeURIComponent(repositoryPath)}`
}

export function isGitTabPath(value: string): boolean {
  return value.startsWith(PREFIX)
}

export function gitRepositoryPath(value: string): string | null {
  if (!isGitTabPath(value)) return null
  try { return decodeURIComponent(value.slice(PREFIX.length)) } catch { return null }
}

export function gitTabLabel(value: string): string {
  const repositoryPath = gitRepositoryPath(value)
  if (repositoryPath === null) return value
  const name = repositoryPath.split('/').filter(Boolean).at(-1)
  return name ? `Git · ${name}` : 'Git'
}
