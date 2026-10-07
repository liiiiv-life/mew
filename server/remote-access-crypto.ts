import { createHash, randomBytes } from 'node:crypto'
import { SignJWT, exportJWK, generateKeyPair, importJWK, jwtVerify, calculateJwkThumbprint, type JWK } from 'jose'
import { REMOTE_LIMITS, sdpFingerprint } from '../shared/remote-access.ts'
export const randomId = () => randomBytes(24).toString('base64url')
export const hashSecret = (value: string) => createHash('sha256').update(value).digest('base64url')
export async function remoteKeyPair() {
  const keys = await generateKeyPair('EdDSA', { extractable: true })
  return { publicKey: await exportJWK(keys.publicKey), privateKey: await exportJWK(keys.privateKey) }
}
export async function signRemoteToken(key: JWK, issuer: string, audience: string, subject: string, claims: Record<string, unknown>, ttl: number = REMOTE_LIMITS.ticket) {
  return new SignJWT(claims).setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', kid: await calculateJwkThumbprint(key) }).setIssuer(issuer).setAudience(audience).setSubject(subject).setJti(randomId()).setIssuedAt().setExpirationTime(Math.floor((Date.now() + ttl) / 1000)).sign(await importJWK(key, 'EdDSA'))
}
export async function verifyRemoteToken(token: string, key: JWK, issuer: string, audience: string) {
  if (typeof token !== 'string' || token.length > 8192 || key.kty !== 'OKP' || key.crv !== 'Ed25519' || key.d) throw new Error('invalid-token')
  const { payload } = await jwtVerify(token, await importJWK(key, 'EdDSA'), { issuer, audience, algorithms: ['EdDSA'], maxTokenAge: '60s', clockTolerance: 2, requiredClaims: ['sub', 'jti', 'iat', 'exp'] })
  if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string' || !payload.exp || !payload.iat || payload.exp - payload.iat > 62) throw new Error('invalid-token')
  return payload
}
export function validateOffer(sdp: unknown) {
  if (typeof sdp !== 'string' || sdp.length > REMOTE_LIMITS.signal - 1024 || !sdp.startsWith('v=0') || / typ relay(?:\s|$)/m.test(sdp)) throw new Error('invalid-offer')
  return sdpFingerprint(sdp)
}
