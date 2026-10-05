export function taskTagHue(tag: string): number {
  let hash = 2166136261
  for (const char of tag) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619)
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b); hash ^= hash >>> 13
  return [8, 35, 78, 155, 190, 225, 270, 325][(hash >>> 0) % 8]
}
