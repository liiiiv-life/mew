import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { CloudStorageFolder } from '../shared/cloud-storage.ts'

export interface DiscoveryOptions {
  home?: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  windowsUsers?: string
  volumes?: string
  release?: string
}

export function isWsl(options: DiscoveryOptions = {}): boolean {
  const env = options.env ?? process.env
  return (options.platform ?? process.platform) === 'linux'
    && !!(env.WSL_DISTRO_NAME || env.WSL_INTEROP || /microsoft/i.test(options.release ?? os.release()))
}

function providerFor(name: string): CloudStorageFolder['provider'] | undefined {
  if (/^onedrive(?:$|[- (])/i.test(name)) return 'onedrive'
  if (/^google ?drive(?:$|[- (])/i.test(name)) return 'google-drive'
  if (/^dropbox(?:$|[- (])/i.test(name)) return 'dropbox'
  return undefined
}

/** Shallow, read-only discovery. A matching folder is not proof of an active sync client. */
export async function discoverCloudStorage(options: DiscoveryOptions = {}): Promise<CloudStorageFolder[]> {
  const home = options.home ?? os.homedir()
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const candidates: CloudStorageFolder[] = []
  async function directories(parent: string) {
    try {
      return (await fs.readdir(parent, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch { return [] }
  }
  async function scan(parent: string) {
    for (const entry of await directories(parent)) {
      const provider = providerFor(entry.name)
      if (provider) candidates.push({ provider, name: entry.name, path: path.join(parent, entry.name) })
    }
  }

  if (platform === 'darwin') {
    // Prefer File Provider's actual location over home-directory aliases.
    await scan(path.join(home, 'Library', 'CloudStorage'))
    candidates.push({ provider: 'icloud', name: 'iCloud Drive', path: path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs') })
    await scan(options.volumes ?? '/Volumes')
  }
  await scan(home)
  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const folder = env[key]
    if (folder && path.isAbsolute(folder)) candidates.push({ provider: 'onedrive', name: path.basename(folder), path: folder })
  }
  // WSL can see Windows sync folders only when the Windows volume is mounted.
  if (isWsl(options)) {
    const users = options.windowsUsers ?? '/mnt/c/Users'
    for (const entry of await directories(users)) {
      if (/^(public|default|default user|all users)$/i.test(entry.name)) continue
      await scan(path.join(users, entry.name))
    }
  }

  const folders: CloudStorageFolder[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    try {
      const canonical = await fs.realpath(candidate.path)
      if (seen.has(canonical) || !(await fs.stat(canonical)).isDirectory()) continue
      await fs.access(canonical, constants.R_OK | constants.X_OK)
      seen.add(canonical)
      folders.push({ ...candidate, path: canonical })
    } catch { /* Missing, inaccessible or disconnected folders are not offered. */ }
  }
  return folders.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
}
