import { diffChars } from 'diff'

export type Edit = { before: string; after: string } | { shared: (string | [string, string])[] }
const json = (value: unknown) => JSON.stringify(value)

/** Keep all common text once, including indentation, punctuation and line endings. */
export function encodeEdit(before: string, after: string): Edit {
  const full: Edit = { before, after }
  const parts = diffChars(before, after, { timeout: 15 })
  if (!parts) return full
  const shared: (string | [string, string])[] = []
  let removed = '', added = ''
  const flush = () => { if (removed || added) shared.push([removed, added]); removed = ''; added = '' }
  for (const part of parts) {
    if (part.removed) removed += part.value
    else if (part.added) added += part.value
    else { flush(); shared.push(part.value) }
  }
  flush()
  const compact = { shared }
  // Local character-size heuristic; model token ratios vary by tokenizer.
  return json(compact).length < json(full).length ? compact : full
}

export function decodeEdit(edit: Edit): [string, string] {
  if ('before' in edit) return [edit.before, edit.after]
  return [0, 1].map(side => edit.shared.map(part => typeof part === 'string' ? part : part[side]).join('')) as [string, string]
}
