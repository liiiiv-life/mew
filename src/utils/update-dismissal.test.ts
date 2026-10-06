import test from 'node:test'
import assert from 'node:assert/strict'

test('dismissed update versions survive reload and only new versions notify again', async () => {
  const storage = new Map<string, string>([['mew:dismissed-update-versions', '["mew:old"]']])
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } })
  const notices = await import('./mewcat-notifications.ts')
  const delivered: number[] = []
  notices.onMewcatNotice(notice => delivered.push(notice.id))
  const input = { kind: 'updates', level: 'warning', source: 'update' } as const
  notices.publishMewcatNotice({ ...input, key: 'old', updateVersions: ['mew:old'] })
  assert.equal(delivered.length, 0)
  notices.publishMewcatNotice({ ...input, key: 'new', updateVersions: ['mew:new', 'tool:1'] })
  assert.equal(delivered.length, 1)
  notices.dismissMewcatNotice(delivered[0])
  assert.deepEqual(JSON.parse(storage.get('mew:dismissed-update-versions')!), ['mew:old', 'mew:new', 'tool:1'])
  notices.publishMewcatNotice({ ...input, key: 'remaining', updateVersions: ['tool:1'] })
  assert.equal(delivered.length, 1)
  notices.publishMewcatNotice({ ...input, key: 'newer', updateVersions: ['tool:2'] })
  assert.equal(delivered.length, 2)
})
