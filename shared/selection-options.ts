export const SELECTION_PALETTE = [8, 20, 35, 50, 65, 78, 105, 130, 155, 175, 190, 210, 225, 250, 270, 325] as const
export type OptionColors = Record<string, number>
export type OptionEdit = { name?: string; hue?: number; remove?: boolean }
export function optionHue(name: string, colors: OptionColors = {}): number {
  if (Object.hasOwn(colors, name)) return colors[name]
  let hash = 2166136261
  for (const char of name) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619)
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b); hash ^= hash >>> 13
  return [8, 35, 78, 155, 190, 225, 270, 325][(hash >>> 0) % 8]
}
export function editSelection(options: string[], colors: OptionColors, option: string, edit: OptionEdit) {
  if (!options.includes(option)) throw new Error('선택 항목을 찾을 수 없습니다')
  if (edit.remove !== undefined && typeof edit.remove !== 'boolean') throw new Error('삭제 여부를 확인하세요')
  if (edit.name !== undefined && (typeof edit.name !== 'string' || !edit.name.trim() || edit.name.trim().length > 500)) throw new Error('선택 항목 이름을 확인하세요')
  if (edit.hue !== undefined && !SELECTION_PALETTE.some(hue => hue === edit.hue)) throw new Error('선택 항목 색상을 확인하세요')
  const name = edit.name?.trim() ?? option
  if (!edit.remove && name !== option && options.includes(name)) throw new Error('같은 이름의 선택 항목이 있습니다')
  const nextOptions = edit.remove ? options.filter(value => value !== option) : options.map(value => value === option ? name : value)
  const nextColors = Object.fromEntries(Object.entries(colors).filter(([key]) => nextOptions.includes(key) && key !== option))
  const optionColors = edit.remove ? nextColors : Object.fromEntries([...Object.entries(nextColors), [name, edit.hue ?? optionHue(option, colors)]])
  return { options: nextOptions, optionColors, name }
}
