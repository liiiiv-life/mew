import assert from 'node:assert/strict'
import test from 'node:test'
import { LARGE_DOWNLOAD_BYTES, formatDownloadSize, isLargeDownload } from './largeDownload.ts'

test('대용량 다운로드 기준은 100MiB다', () => {
  assert.equal(LARGE_DOWNLOAD_BYTES, 104_857_600)
  assert.equal(formatDownloadSize(LARGE_DOWNLOAD_BYTES), '100.0MB')
  assert.equal(isLargeDownload(LARGE_DOWNLOAD_BYTES), false)
  assert.equal(isLargeDownload(LARGE_DOWNLOAD_BYTES + 1), true)
})
