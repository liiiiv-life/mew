// 통합 테스트 — 실제 Postgres 필요. DATABASE_URL이 없거나 접속 불가하면 통째로 skip한다.
// 실행: `npm run db:up` 후 `npm test`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { isDbConfigured, exec, closePool } from './pool.ts'
import { quoteIdent, projectSchema } from './identifiers.ts'
import { subscribeDb, type DbEvent } from './hub.ts'
import * as svc from './databaseService.ts'

// vitest처럼 .env를 자동 로드하지 않으므로 여기서 mew/.env를 로드한다.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
} catch {
  // .env 없으면 process.env에 이미 있는 값을 쓴다
}

test('databaseService 통합', async (t) => {
  if (!isDbConfigured()) {
    t.skip('DATABASE_URL 미설정 — `npm run db:up` 후 재실행')
    return
  }
  try {
    await exec('SELECT 1')
  } catch (err) {
    t.skip(`Postgres 접속 불가: ${(err as Error).message}`)
    return
  }

  const project = `test_${Math.random().toString(36).slice(2, 8)}`
  let dbId = ''
  let firstColId = ''
  let rowId = ''
  let numColId = ''

  t.after(async () => {
    try {
      await exec(`DROP SCHEMA IF EXISTS ${quoteIdent(projectSchema(project))} CASCADE`)
      await exec(`DELETE FROM mew.databases WHERE project = $1`, [project])
    } catch {
      // 정리 실패는 무시 (다음 실행에 영향 없음 — 매번 랜덤 프로젝트)
    }
    await closePool()
  })

  await t.test('createDatabase는 기본 컬럼 하나로 managed DB를 만든다', async () => {
    const view = await svc.createDatabase(project, '  내 DB  ', 'tester@x.com')
    assert.equal(view.kind, 'managed')
    assert.equal(view.editable, true)
    assert.equal(view.title, '내 DB') // trim
    assert.equal(view.columns.length, 1)
    assert.equal(view.columns[0].type, 'text')
    assert.equal(view.rows.length, 0)
    dbId = view.id
    firstColId = view.columns[0].id
  })

  await t.test('insertRow → getView에 빈 셀 행이 보인다', async () => {
    const row = await svc.insertRow(project, dbId)
    rowId = row.id
    const view = await svc.getView(project, dbId)
    assert.equal(view.rows.length, 1)
    assert.equal(view.rows[0].id, rowId)
    assert.equal(view.rows[0].cells[firstColId], null)
  })

  await t.test('updateCell은 값을 저장하고 getView에 반영된다', async () => {
    await svc.updateCell(project, dbId, rowId, firstColId, '안녕')
    const view = await svc.getView(project, dbId)
    assert.equal(view.rows[0].cells[firstColId], '안녕')
  })

  await t.test('addColumn(number)은 숫자 검증/저장을 한다', async () => {
    const col = await svc.addColumn(project, dbId, '점수', 'number')
    numColId = col.id
    assert.equal(col.type, 'number')
    await svc.updateCell(project, dbId, rowId, numColId, '42')
    const view = await svc.getView(project, dbId)
    assert.equal(view.rows[0].cells[numColId], 42)
    await assert.rejects(() => svc.updateCell(project, dbId, rowId, numColId, '숫자아님'), svc.DbValidationError)
  })

  await t.test('renameColumn은 표시 이름을 바꾼다', async () => {
    await svc.renameColumn(project, dbId, numColId, '총점')
    const view = await svc.getView(project, dbId)
    assert.equal(view.columns.find((c) => c.id === numColId)?.name, '총점')
  })

  await t.test('checkbox/date 타입 강제 변환', async () => {
    const chk = await svc.addColumn(project, dbId, '완료', 'checkbox')
    const dt = await svc.addColumn(project, dbId, '마감', 'date')
    await svc.updateCell(project, dbId, rowId, chk.id, 'true')
    await svc.updateCell(project, dbId, rowId, dt.id, '2026-07-23')
    const view = await svc.getView(project, dbId)
    assert.equal(view.rows[0].cells[chk.id], true)
    assert.equal(view.rows[0].cells[dt.id], '2026-07-23')
    await assert.rejects(() => svc.updateCell(project, dbId, rowId, dt.id, '2026/07/23'), svc.DbValidationError)
  })

  await t.test('deleteColumn은 컬럼을 제거한다', async () => {
    await svc.deleteColumn(project, dbId, numColId)
    const view = await svc.getView(project, dbId)
    assert.equal(view.columns.find((c) => c.id === numColId), undefined)
  })

  await t.test('deleteRow는 행을 제거한다', async () => {
    await svc.deleteRow(project, dbId, rowId)
    const view = await svc.getView(project, dbId)
    assert.equal(view.rows.length, 0)
  })

  await t.test('프로젝트 격리 — 다른 프로젝트에서는 조회 불가', async () => {
    await assert.rejects(() => svc.getView('other_project_zzz', dbId), svc.DbObjectNotFoundError)
  })

  await t.test('external 참조는 읽기 전용이며 원본 데이터를 보여준다', async () => {
    const schema = projectSchema(project)
    await exec(`CREATE TABLE ${quoteIdent(schema)}.ext_src (name text, qty integer)`)
    await exec(`INSERT INTO ${quoteIdent(schema)}.ext_src (name, qty) VALUES ('사과', 3), ('배', 5)`)
    const attached = await svc.attachExternal(project, schema, 'ext_src', '재고', 'tester@x.com')
    assert.equal(attached.kind, 'external')
    assert.equal(attached.editable, false)
    const view = await svc.getView(project, attached.id)
    assert.equal(view.rows.length, 2)
    const nameCol = view.columns.find((c) => c.name === 'name')!
    const qtyCol = view.columns.find((c) => c.name === 'qty')!
    assert.equal(qtyCol.type, 'number')
    assert.deepEqual(view.rows.map((r) => r.cells[nameCol.id]).sort(), ['배', '사과'])
    // external 편집 시도는 거부된다
    await assert.rejects(() => svc.insertRow(project, attached.id), svc.DbReadOnlyError)
  })

  await t.test('실시간 이벤트가 방송된다', async () => {
    const events: DbEvent[] = []
    const unsub = subscribeDb(project, dbId, (e) => events.push(e))
    const row = await svc.insertRow(project, dbId)
    await svc.updateCell(project, dbId, row.id, firstColId, '실시간')
    await svc.deleteRow(project, dbId, row.id)
    unsub()
    assert.deepEqual(
      events.map((e) => e.type),
      ['row.insert', 'row.update', 'row.delete'],
    )
  })
})
