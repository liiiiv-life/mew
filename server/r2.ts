import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import crypto from 'node:crypto'
import path from 'node:path'

export class R2NotConfiguredError extends Error {}

const REQUIRED_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL_BASE'] as const

function assertConfigured() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key])
  if (missing.length) {
    throw new R2NotConfiguredError(`R2 자격증명이 설정되지 않았습니다: ${missing.join(', ')} (mew/.env.example 참고)`)
  }
}

function client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

/** Uploads a buffer to the docs-media R2 bucket under a random key and returns its public URL. */
export async function uploadAsset(buffer: Buffer, originalName: string, contentType: string): Promise<string> {
  assertConfigured()
  const key = `${crypto.randomUUID()}${path.extname(originalName)}`
  await client().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  )
  const base = process.env.R2_PUBLIC_URL_BASE!.replace(/\/+$/, '')
  // 스킴 없는 도메인만 설정된 경우 상대경로로 해석되는 것을 방지
  return `${/^https?:\/\//.test(base) ? base : `https://${base}`}/${key}`
}
