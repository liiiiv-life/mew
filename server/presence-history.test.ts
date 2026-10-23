import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import { once } from 'node:events'
import express from 'express'
import { PresenceHistoryStore, HISTORY_MAX_RECORDS, parseHistoryRange, recordPresence, endPresence, historyScope } from './presence-history.ts'
import { createPresenceHistoryRouter } from './presence-history-routes.ts'
import { setFileRule } from './access-policy.ts'
import type { ActiveMewSession, MewSessionHistory } from '../shared/active-sessions.ts'
import { sessionHistoryXlsx } from './session-history-xlsx.ts'
import { parseXlsx } from '../src/utils/xlsx.ts'
import { sessionHistoryBounds, normalizeSessionHistoryFilter } from '../shared/active-sessions.ts'

const base = (id: string, at: number): ActiveMewSession => ({ id, email: 'alice@example.test', displayName: 'Alice', connectedAt: at, browser: 'Chrome', device: 'Mac', project: 'docs', workspaceLabel: 'Private workspace', path: 'secret.md', visible: true, agents: { running: 2, reportedAt: at } })

test('history persists state intervals, clips midnight/ranges and recovers unclosed sessions at last observation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-history-')), file = path.join(dir, 'history.sqlite')
  const midnight = new Date('2026-09-30T00:00:00Z').getTime(), start = midnight - 3600_000
  let store = new PresenceHistoryStore(file)
  try {
    store.observe(base('one', start), start)
    store.observe({ ...base('one', start), agents: { running: 2, reportedAt: start + 30_000 } }, start + 30_000)
    store.observe({ ...base('one', start), path: 'other.md', visible: false }, midnight + 3600_000)
    store.disconnect('one', midnight + 7200_000)
    store.observe({ ...base('two', midnight + 1800_000), email: null, displayName: null }, midnight + 1800_000)
    store.observe({ ...base('two', midnight + 1800_000), email: null, displayName: null }, midnight + 5400_000)
    const range = { dayFrom: midnight, dayTo: midnight + 86400_000, from: midnight, to: midnight + 86400_000 }
    const history = store.query(range, () => true)
    assert.equal(history.records.length, 3)
    assert.equal(history.records[0].startedAt, midnight)
    assert.equal(history.records[0].endedAt, midnight + 3600_000)
    assert.equal(history.records[2].visible, false)
    assert.equal(history.records[2].endedAt, midnight + 7200_000)
    assert.equal(history.records[0].disconnectedAt, midnight + 7200_000)
    const filtered = store.query({ ...range, from: midnight + 3600_000, to: midnight + 4000_000, person: 'alice@example.test' }, () => false)
    assert.equal(filtered.records.length, 1)
    assert.equal(filtered.records[0].endedAt, midnight + 4000_000)
    assert.equal(filtered.records[0].path, null)
    assert.equal(filtered.records[0].workspaceLabel, null)
    assert.equal(filtered.people.length, 2)
    assert.equal(store.query({ ...range, person: 'guest' }, () => true).records.length, 1)
    store.close(); store = new PresenceHistoryStore(file)
    const recovered = store.query(range, () => true).records.find(record => record.id === 'two')!
    assert.equal(recovered.disconnectedAt, midnight + 5400_000)
    assert.equal(recovered.endedAt, recovered.disconnectedAt)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('future-schema and damaged history databases are preserved, not reset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-history-corrupt-')), file = path.join(dir, 'history.sqlite')
  try {
    fs.writeFileSync(file, 'damaged')
    assert.throws(() => new PresenceHistoryStore(file))
    assert.equal(fs.readFileSync(file, 'utf8'), 'damaged')
    fs.unlinkSync(file)
    const db = new DatabaseSync(file); db.exec('PRAGMA user_version=99'); db.close()
    assert.throws(() => new PresenceHistoryStore(file), /Unsupported/)
    const unchanged = new DatabaseSync(file); assert.equal(unchanged.prepare('PRAGMA user_version').get()!.user_version, 99); unchanged.close()
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('query validation and local date boundaries include DST days', () => {
  const query = { from: '1000', to: '2000', dayFrom: '0', dayTo: '86400000' }
  assert.equal(parseHistoryRange(query).from, 1000)
  for (const invalid of [{ to: '999' }, { dayTo: '90000001' }, { from: '-1' }, { from: ['1000'] }, { person: ['alice'] }]) assert.throws(() => parseHistoryRange({ ...query, ...invalid }))
  const original = process.env.TZ
  try {
    process.env.TZ = 'America/New_York'
    const spring = sessionHistoryBounds({ day: '2026-03-08', fromHour: 0, toHour: 24, person: '' })
    const fall = sessionHistoryBounds({ day: '2026-11-01', fromHour: 0, toHour: 24, person: '' })
    const normalized = normalizeSessionHistoryFilter({ day: '2026-03-08', fromHour: 2, toHour: 3, person: '' })
    assert.equal(normalized.toHour, 4)
    assert.equal(spring.to - spring.from, 23 * 3600_000)
    assert.equal(fall.to - fall.from, 25 * 3600_000)
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original }
})

test('history API and real XLSX enforce auth and current path permissions for the same filtered range', async () => {
  const now = Date.now(), dayFrom = now - 3600_000, dayTo = now + 3600_000
  recordPresence(base('api-one', dayFrom), dayFrom)
  endPresence('api-one', now)
  const app = express()
  app.use((req, _res, next) => { req.auth = { role: req.headers['x-role'] === 'member' ? 'member' : 'guest', email: req.headers['x-role'] === 'member' ? 'reader@example.test' : null, mustChangePassword: req.headers['x-password'] === 'yes' }; next() })
  app.use('/history', createPresenceHistoryRouter())
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address() as { port: number }, url = `http://127.0.0.1:${address.port}/history`
  const query = new URLSearchParams({ from: String(dayFrom), to: String(dayTo), dayFrom: String(dayFrom), dayTo: String(dayTo), person: 'alice@example.test' })
  try {
    assert.equal((await fetch(`${url}?${query}`)).status, 403)
    assert.equal((await fetch(`${url}/export?${query}`)).status, 403)
    assert.equal((await fetch(`${url}?${query}`, { headers: { 'x-role': 'member', 'x-password': 'yes' } })).status, 403)
    assert.equal((await fetch(`${url}?from=wrong`, { headers: { 'x-role': 'member' } })).status, 400)
    setFileRule('reader@example.test', 'docs', 'secret.md', 'deny')
    const response = await fetch(`${url}?${query}`, { headers: { 'x-role': 'member' } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const history = await response.json() as MewSessionHistory
    assert.equal(history.records.length, 1)
    assert.equal(history.records[0].path, null)
    assert.equal(history.records[0].project, null)
    assert.equal(history.records[0].workspaceLabel, null)
    assert.equal(JSON.stringify(history).includes(historyScope('docs')!), false)
    const exported = await fetch(`${url}/export?${query}`, { headers: { 'x-role': 'member' } })
    assert.match(exported.headers.get('content-type')!, /spreadsheetml/)
    const [sheet] = await parseXlsx(await exported.arrayBuffer())
    assert.equal(sheet.rows.length, 2)
    assert.equal(sheet.rows[1][1], 'alice@example.test')
    assert.equal(sheet.rows[1][11], '')
    assert.equal(sheet.rows[1][10], '')
    // User-supplied text resembling a formula remains string data.
    const malicious = { ...history.records[0], displayName: '=HYPERLINK("https://example.test")', path: '<script>&日本語' }
    const xlsx = sessionHistoryXlsx([malicious])
    const [roundtrip] = await parseXlsx(xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength) as ArrayBuffer)
    assert.equal(roundtrip.rows[1][0], malicious.displayName)
    assert.equal(roundtrip.rows[1][11], malicious.path)
    assert.equal(xlsx.includes(Buffer.from('<f>')), false)
    fs.writeFileSync('/tmp/mew-session-history-test.xlsx', xlsx)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})


test('large history queries fail explicitly rather than silently truncating an Excel export', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-history-limit-')), file = path.join(dir, 'history.sqlite')
  const store = new PresenceHistoryStore(file)
  try {
    store.observe(base('many', 1000), 1000); store.disconnect('many', 2000)
    const db = new DatabaseSync(file)
    try {
      db.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<?)
        INSERT INTO intervals(connection_id,started_at,ended_at,email,snapshot,scope)
        SELECT 'many',1000,2000,'alice@example.test',(SELECT snapshot FROM intervals WHERE id=1),NULL FROM numbers`).run(HISTORY_MAX_RECORDS)
    } finally { db.close() }
    assert.throws(() => store.query({ dayFrom: 0, dayTo: 86400_000, from: 0, to: 86400_000 }, () => true), /Too many records/)
    assert.equal(store.query({ dayFrom: 0, dayTo: 86400_000, from: 0, to: 86400_000, person: 'other@example.test' }, () => true).records.length, 0)
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
