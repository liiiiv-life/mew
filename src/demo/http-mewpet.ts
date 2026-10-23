import manifest from '../../public/mewcat/capybara/skin.json' with { type: 'json' }
import { MEWPET_ANIMATIONS, type MewpetAnimation, type MewpetFileSkin, type MewpetSkinCatalog, type MewpetSprites, type MewpetFileSprite } from '../../shared/mewpet-skins.ts'
import { demoJson, requireMethod, type DemoHttpHandler } from './http.ts'

export function demoMewpetAsset(pathname: string): string | null {
  const match = pathname.match(/^\/api\/mewpet\/skins\/capybara\/([a-z-]+)$/)
  if (!match || !MEWPET_ANIMATIONS.includes(match[1] as MewpetAnimation)) return null
  const sprite = manifest.sprites[match[1] as keyof typeof manifest.sprites]
  return `/demo/mewcat/capybara/${sprite.file}`
}

/** Reuse the shipped default pet; only immutable public sprite files use native fetch. */
export const handleDemoMewpet: DemoHttpHandler = async ({ request, url }) => {
  if (url.pathname === '/api/mewpet/skins') {
    requireMethod(request, 'GET')
    const sprites = Object.fromEntries(Object.entries(manifest.sprites).map(([action, sprite]) => [action, { url: `/api/mewpet/skins/capybara/${action}?v=demo-builtin-v1`, frames: sprite.frames, width: sprite.frames * 128, height: 128 }])) as MewpetSprites<MewpetFileSprite>
    const skin: MewpetFileSkin = { id: manifest.id, name: manifest.name, translated: manifest.translated, managed: false, revision: 'demo-builtin-v1', sprites }
    return demoJson({ skins: [skin], failed: false, canManage: false } satisfies MewpetSkinCatalog)
  }
  const asset = demoMewpetAsset(url.pathname)
  if (asset) {
    requireMethod(request, 'GET')
    return globalThis.fetch(new URL(asset, url.origin), { method: 'GET', signal: request.signal, cache: 'force-cache', credentials: 'omit' })
  }
}
