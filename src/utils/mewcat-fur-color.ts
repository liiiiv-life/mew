export const MEWCAT_FUR_COLOR_KEY = 'mew:mewcat-fur-color'
export const DEFAULT_MEWCAT_FUR_COLOR = '#171717'
export function normalizeMewcatFurColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_MEWCAT_FUR_COLOR
}
export function loadMewcatFurColor(storage?: Pick<Storage, 'getItem'>): string {
  try { return normalizeMewcatFurColor((storage ?? localStorage).getItem(MEWCAT_FUR_COLOR_KEY)) } catch { return DEFAULT_MEWCAT_FUR_COLOR }
}
export function saveMewcatFurColor(value: string, storage?: Pick<Storage, 'setItem'>): string {
  const color = normalizeMewcatFurColor(value)
  try { (storage ?? localStorage).setItem(MEWCAT_FUR_COLOR_KEY, color) } catch { /* Session color still applies. */ }
  return color
}
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  })
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
}
export function mewcatFurPalette(value: string): Record<string, string> {
  const fur = normalizeMewcatFurColor(value), light = luminance(fur)
  const contrast = (color: string) => (Math.max(light, luminance(color)) + .05) / (Math.min(light, luminance(color)) + .05)
  const ink = contrast('#e8d99b') >= 3 ? '#e8d99b' : '#171717'
  return { '--mewcat-fur': fur, '--mewcat-ink': ink, '--mewcat-outline': light > .3 ? '#4b4b4b' : '#737373', '--mewcat-stripe': fur === DEFAULT_MEWCAT_FUR_COLOR || light > .3 ? '#353535' : '#737373' }
}
