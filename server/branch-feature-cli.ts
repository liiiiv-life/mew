import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BranchFeatureError, readBranchFeatures, updateBranchFeature } from './branch-features.ts'

export async function branchFeatureCli(args: string[], input: string): Promise<string> {
  let cwd = process.cwd()
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--cwd' || !args[i + 1]) throw new BranchFeatureError('사용법: node server/branch-feature-cli.ts [--cwd <worktree>] < metadata.json')
    cwd = path.resolve(args[++i]!)
  }
  let value: unknown
  try { value = JSON.parse(input) } catch { throw new BranchFeatureError('표준 입력에 JSON 객체를 전달하세요.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BranchFeatureError('표준 입력에 JSON 객체를 전달하세요.')
  const snapshot = await readBranchFeatures(cwd)
  const branch = (value as Record<string, unknown>).branch ?? snapshot.currentBranch
  if (!branch) throw new BranchFeatureError('현재 브랜치를 찾을 수 없습니다. branch를 지정하세요.')
  await updateBranchFeature(cwd, { ...value, branch })
  return JSON.stringify({ ok: true, branch }) + '\n'
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.stdout.write(await branchFeatureCli(process.argv.slice(2), fs.readFileSync(0, 'utf8'))) }
  catch (error) { process.stderr.write((error instanceof Error ? error.message : '브랜치 정보 저장 실패') + '\n'); process.exitCode = 1 }
}
