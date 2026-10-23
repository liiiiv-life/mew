import test from 'node:test'
import assert from 'node:assert/strict'
import { portPreviewEntry } from './port-preview-entry.ts'
import { normalizeFeatureOverrides } from '../../shared/access-policy.ts'

test('preview entry accepts an explicit port and preserves app routes', () => {
  assert.deepEqual(portPreviewEntry('?preview=3333&previewPath=%2Fsettings%3Ftab%3Dprofile'), { port: 3333, path: '/settings?tab=profile' })
  assert.deepEqual(portPreviewEntry('?preview=65535'), { port: 65535, path: '/' })
  for (const search of ['', '?preview=0', '?preview=65536', '?preview=80x', '?preview=3333&previewPath=//evil.test/', '?preview=3333&previewPath=%2F%5Cevil.test', '?preview=3333&previewPath=%2F%0A']) assert.equal(portPreviewEntry(search), null, search)
})

test('retired browser grants migrate to localhost preview without reviving a browser capability', () => {
  assert.deepEqual(normalizeFeatureOverrides({ browser: false, agent: true, unknown: true }), { agent: true, portPreview: false })
  assert.deepEqual(normalizeFeatureOverrides({ browser: true, portPreview: false }), { portPreview: false })
})
