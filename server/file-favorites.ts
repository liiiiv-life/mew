import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { discoverCloudStorage, isWsl, type DiscoveryOptions } from './cloud-storage.ts'
import { readFileFavorites, updateFileFavorite } from './userUiState.ts'
import { BrowseError } from './fsBrowse.ts'
import type { FileFavorite, FileFavoritePreferences } from '../shared/file-favorites.ts'

/** Only known, shallow locations on the server. Never scans arbitrary directory trees. */
export async function discoverFileFavorites(options: DiscoveryOptions & { windowsDrive?: string } = {}): Promise<FileFavorite[]> {
  const home = options.home ?? os.homedir()
  const wsl = isWsl(options)
  const candidates: FileFavorite[] = [{ path: home, name: path.basename(home), kind: wsl ? 'wsl-home' : 'home' }]
  const standard = [['Desktop', 'desktop'], ['Downloads', 'downloads'], ['Documents', 'documents'], ['Pictures', 'pictures'], ['Music', 'music'], ['Movies', 'movies']] as const
  for (const [name, kind] of standard) candidates.push({ path: path.join(home, name), name, kind })
  if (wsl) {
    candidates.push({ path: options.windowsDrive ?? '/mnt/c', name: 'C:', kind: 'drive' })
    const users = options.windowsUsers ?? '/mnt/c/Users'
    const profiles = await fs.readdir(users, { withFileTypes: true }).catch(() => [])
    for (const profile of profiles.sort((a, b) => a.name.localeCompare(b.name))) {
      if ((!profile.isDirectory() && !profile.isSymbolicLink()) || /^(public|default|default user|all users)$/i.test(profile.name)) continue
      for (const [name, kind] of standard.slice(0, 3)) {
        candidates.push({ path: path.join(users, profile.name, name), name, kind, account: profile.name })
      }
    }
  }
  const clouds = await discoverCloudStorage(options)
  for (const cloud of clouds) {
    candidates.push({ ...cloud, kind: 'cloud' })
    // OneDrive folder backup can move Windows Desktop/Documents out of the profile root.
    if (wsl && cloud.provider === 'onedrive') {
      for (const [name, kind] of standard.slice(0, 3)) candidates.push({ path: path.join(cloud.path, name), name, kind, account: cloud.name })
    }
  }
  const found: FileFavorite[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    try {
      const canonical = await fs.realpath(candidate.path)
      if (seen.has(canonical) || !(await fs.stat(canonical)).isDirectory()) continue
      await fs.access(canonical, constants.R_OK | constants.X_OK)
      seen.add(canonical)
      found.push({ ...candidate, path: canonical })
    } catch { /* Unmounted, missing and inaccessible defaults are omitted. */ }
  }
  return found
}

export function mergeFileFavorites(defaults: FileFavorite[], preferences: FileFavoritePreferences): FileFavorite[] {
  const hidden = new Set(preferences.hidden)
  const result = defaults.filter(folder => !hidden.has(folder.path))
  const seen = new Set(result.map(folder => folder.path))
  for (const favorite of preferences.added) {
    if (hidden.has(favorite) || seen.has(favorite)) continue
    result.push({ path: favorite, name: path.basename(favorite) || favorite, kind: 'custom' })
    seen.add(favorite)
  }
  return result
}

export async function listFileFavorites(email: string): Promise<FileFavorite[]> {
  const defaults = await discoverFileFavorites()
  return mergeFileFavorites(defaults, readFileFavorites(email))
}

export async function changeFileFavorite(email: string, input: unknown): Promise<void> {
  const value = input as { path?: unknown; favorite?: unknown } | null
  if (!value || typeof value.path !== 'string' || !path.isAbsolute(value.path) || value.path.length > 4096 || value.path.includes('\0') || typeof value.favorite !== 'boolean') {
    throw new BrowseError('Invalid favorite folder')
  }
  let target = path.normalize(value.path)
  if (value.favorite) {
    target = await fs.realpath(target)
    if (!(await fs.stat(target)).isDirectory()) throw new BrowseError('Choose a folder')
    await fs.access(target, constants.R_OK | constants.X_OK)
  }
  // Removals also work for disconnected mounts and folders that no longer exist.
  updateFileFavorite(email, target, value.favorite)
}
