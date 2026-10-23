import path from 'node:path'
import type { JWK } from 'jose'
import { DATA_DIR, readJsonFile, writeFileAtomic } from './dataDir.ts'
export type RemoteRegistration = { origin: string; instance: string; owner: string; name: string; publicKey: JWK; privateKey: JWK; centralKey: JWK; accounts: Record<string, string> }
const file = path.join(DATA_DIR, 'remote-access.json')
export function readRemoteRegistration(): RemoteRegistration | null {
  const state = readJsonFile<{ version: number; registration: RemoteRegistration | null }>(file)
  if (!state) return null
  if (state.version !== 1) throw new Error('원격 접속 설정 버전이 올바르지 않습니다.')
  const reg = state.registration
  if (!reg) return null
  if (new URL(reg.origin).protocol !== 'https:' || reg.publicKey?.kty !== 'OKP' || reg.privateKey?.kty !== 'OKP' || !reg.privateKey.d || reg.centralKey?.d || !reg.instance || !reg.owner || !reg.accounts || typeof reg.accounts !== 'object' || Object.values(reg.accounts).some(value => typeof value !== 'string')) throw new Error('원격 접속 설정이 손상됐습니다.')
  return reg
}
export function saveRemoteRegistration(registration: RemoteRegistration | null) { writeFileAtomic(file, JSON.stringify({ version: 1, registration }, null, 2) + '\n') }
