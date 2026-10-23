import { parse, type ParseError } from 'jsonc-parser'

export class CommitResponseSyntaxError extends Error {
  constructor() { super('에이전트의 JSON 응답 형식을 복구하지 못했습니다. 변경사항은 커밋하지 않았습니다. 다시 시도해 주세요.') }
}

/** Accept harmless JSON formatting, but never use a parser's partial recovery result. */
export function parseCommitResponse<T>(output: string): T {
  const text = output.trim().replace(/^```(?:json|jsonc)?\s*\n([\s\S]*?)\n```$/i, '$1')
  try { return JSON.parse(text) as T } catch { /* Comments and trailing commas do not change values. */ }
  const errors: ParseError[] = []
  const value = parse(text, errors, { allowTrailingComma: true })
  if (errors.length) throw new CommitResponseSyntaxError()
  return value as T
}
