/** Resolve exact changed paths; never interpret user input as a Git path pattern. */
export function selectedGitFiles<T extends { path: string }>(files: T[], input: unknown): T[] {
  if (!Array.isArray(input) || input.length === 0 || input.some(value => typeof value !== 'string')) {
    throw new Error('커밋할 파일을 선택하세요')
  }
  const paths = new Set(input as string[])
  const selected = files.filter(file => paths.has(file.path))
  if (selected.length !== paths.size) throw new Error('선택한 변경 파일이 달라졌습니다. 새로고침 후 다시 선택하세요.')
  return selected
}
