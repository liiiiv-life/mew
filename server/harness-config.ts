import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { parse as parseJson, modify, applyEdits, type ParseError } from 'jsonc-parser'
import { parseDocument } from 'yaml'
import { isDeepStrictEqual } from 'node:util'
import JSON5 from 'json5'

export type ConfigFormat = 'json' | 'jsonc' | 'json5' | 'toml' | 'yaml'
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('설정은 객체여야 합니다')
  return value as Record<string, unknown>
}
export function parseConfig(text: string, format: ConfigFormat): Record<string, unknown> {
  if (!text.trim()) return {}
  if (format === 'toml') return object(parseToml(text))
  if (format === 'json5') return object(JSON5.parse(text))
  if (format === 'yaml') {
    const doc = parseDocument(text, { uniqueKeys: true })
    if (doc.errors.length) throw new Error('YAML 문법을 확인하세요')
    return object(doc.toJS({ maxAliasCount: 50 }) ?? {})
  }
  const errors: ParseError[] = []
  const result = parseJson(text, errors, { allowTrailingComma: format === 'jsonc', disallowComments: format === 'json' })
  if (errors.length) throw new Error('JSON 문법을 확인하세요')
  return object(result)
}
export function atKeys(root: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  let value: unknown = root
  for (const key of keys) {
    if (!Object.hasOwn(object(value), key)) return {}
    value = object(value)[key]
  }
  return object(value)
}

/** Only the selected MCP entry changes. JSONC/YAML retain comments; TOML retains all non-MCP bytes. */
export function patchConfig(text: string, format: ConfigFormat, keys: string[], name: string, value: unknown | undefined): string {
  const before = parseConfig(text, format)
  const expected = structuredClone(before)
  let cursor = expected
  for (const key of keys) {
    if (!Object.hasOwn(cursor, key)) Object.defineProperty(cursor, key, { value: {}, enumerable: true, writable: true, configurable: true })
    cursor = object(cursor[key])
  }
  if (value === undefined) delete cursor[name]
  else Object.defineProperty(cursor, name, { value, enumerable: true, writable: true, configurable: true })
  let result: string
  if (format === 'json5') {
    // JSON is valid JSON5. Keep every value; the UI discloses formatting/comment normalization.
    result = JSON.stringify(expected, null, 2)
  } else if (format === 'yaml') {
    const doc = parseDocument(text || '{}', { uniqueKeys: true })
    if (value === undefined) doc.deleteIn([...keys, name])
    else doc.setIn([...keys, name], value)
    result = doc.toString()
  } else if (format === 'toml') {
    // Support native table syntax, including quoted server names and child tables.
    // Validate the full semantic result before writing; inline/dotted layouts are never guessed.
    const lines = text.split(/(?<=\n)/)
    let inMcp = false
    const kept: string[] = []
    for (const line of lines) {
      if (/^\s*\[/.test(line)) {
        inMcp = /^\s*\[\s*(?:mcp_servers|"mcp_servers"|'mcp_servers')\s*[.\]]/.test(line)
      }
      if (!inMcp) kept.push(line)
    }
    const base = kept.join('')
    const without = parseConfig(base, format)
    if (Object.hasOwn(without, 'mcp_servers')) throw new Error('인라인 MCP 설정은 표 형식 [mcp_servers.이름]으로 바꾼 후 편집하세요')
    result = `${base.trimEnd()}\n\n${stringifyToml({ mcp_servers: expected.mcp_servers as never })}`
  } else {
    result = applyEdits(text || '{}', modify(text || '{}', [...keys, name], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }))
  }
  if (!isDeepStrictEqual(parseConfig(result, format), expected)) throw new Error('다른 설정을 보존할 수 없는 형식입니다. 원본 설정을 확인하세요')
  return result.endsWith('\n') ? result : `${result}\n`
}
