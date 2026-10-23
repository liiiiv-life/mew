import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)

const here = path.dirname(fileURLToPath(import.meta.url))
const OXLINT_BIN = path.resolve(here, '../node_modules/.bin/oxlint')

/** oxlint가 처리하는 확장자 — 클라이언트 CodePane의 OXLINT_EXTS와 맞춰야 한다 */
export const LINTABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

export interface LintDiagnostic {
  from: number
  to: number
  severity: 'error' | 'warning' | 'info'
  message: string
  code: string | null
}

interface OxlintDiagnostic {
  message?: string
  code?: string
  severity?: string
  help?: string
  labels?: { span?: { offset?: number; length?: number } }[]
}

/**
 * 편집 중인 버퍼를 임시 파일로 lint한다 — 디스크 저장본과 무관하게 화면 내용 그대로 검사.
 * 프로젝트 루트에 .oxlintrc.json이 있으면 그 규칙을 따른다.
 */
export async function lintContent(relPath: string, content: string, projectRootDir: string): Promise<LintDiagnostic[]> {
  if (!LINTABLE_EXTENSIONS.has(path.extname(relPath).toLowerCase())) return []
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-lint-'))
  const tmpFile = path.join(tmpDir, path.basename(relPath))
  try {
    fs.writeFileSync(tmpFile, content, 'utf-8')
    const args: string[] = []
    const config = path.join(projectRootDir, '.oxlintrc.json')
    if (fs.existsSync(config)) args.push('-c', config)
    args.push('--format', 'json', tmpFile)
    // error 수준 진단이 있으면 oxlint가 종료 코드 1을 내지만 stdout의 JSON은 그대로 유효하다
    let stdout: string
    try {
      stdout = (await exec(OXLINT_BIN, args, { timeout: 10_000 })).stdout
    } catch (err) {
      const failed = err as { stdout?: string }
      if (typeof failed.stdout !== 'string' || !failed.stdout) throw err
      stdout = failed.stdout
    }
    const parsed = JSON.parse(stdout) as { diagnostics?: OxlintDiagnostic[] }
    // oxlint의 span.offset은 UTF-8 바이트 오프셋 — CodeMirror가 쓰는 UTF-16 인덱스로 변환한다
    // (한글 주석·문자열이 있으면 둘이 어긋난다)
    const buf = Buffer.from(content, 'utf-8')
    const toUtf16 = (byteOffset: number) => buf.subarray(0, Math.min(byteOffset, buf.length)).toString('utf-8').length
    const diagnostics: LintDiagnostic[] = []
    for (const d of parsed.diagnostics ?? []) {
      const span = d.labels?.[0]?.span
      if (!span || typeof span.offset !== 'number') continue
      diagnostics.push({
        from: toUtf16(span.offset),
        to: toUtf16(span.offset + (span.length ?? 0)),
        severity: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info',
        message: d.help ? `${d.message ?? ''} — ${d.help}` : (d.message ?? ''),
        code: d.code ?? null,
      })
    }
    return diagnostics
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
