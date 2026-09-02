import fs from 'node:fs'
import path from 'node:path'

/** 테스트가 만든 명시적 임시 루트에만 대형 파일 트리를 채운다. 사용자 workspace 경로는 받지 않는다. */
export function createSearchPerfFixture(root: string, fileCount = 10_000): { files: number; directories: number } {
  if (!path.isAbsolute(root) || !path.basename(root).startsWith('zperf')) {
    throw new Error('성능 fixture는 zperf* 임시 프로젝트에만 만들 수 있습니다')
  }
  const directories = Math.max(1, Math.ceil(fileCount / 100))
  for (let dirIndex = 0; dirIndex < directories; dirIndex += 1) {
    const dir = path.join(root, `scope-${String(dirIndex).padStart(4, '0')}`)
    fs.mkdirSync(dir, { recursive: true })
    const start = dirIndex * 100
    const end = Math.min(fileCount, start + 100)
    for (let fileIndex = start; fileIndex < end; fileIndex += 1) {
      const name = fileIndex % 97 === 0 ? `SearchPanel-${fileIndex}.tsx` : `module-${fileIndex}.ts`
      fs.writeFileSync(path.join(dir, name), `export const value${fileIndex} = "needle-${fileIndex}"\n`)
    }
  }
  return { files: fileCount, directories }
}
