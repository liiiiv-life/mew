// 전용 Postgres를 MEW_DB_TEST_DATABASE_URL로 지정한 경우에만 통합 테스트를 실행한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { parse } from 'yaml'
import { pathsForWorkspace, workspaceContext } from '../paths.ts'
import { isDbConfigured, exec, closePool } from './pool.ts'
import { quoteIdent, projectSchema } from './identifiers.ts'
import { subscribeDb, type DbEvent } from './hub.ts'
import * as svc from './databaseService.ts'
import { saveDatabaseRowPage, remapDatabaseRowPages } from './rowPageIntegration.ts'
import { RowPageError } from './rowPages.ts'

process.env.DATABASE_URL = process.env.MEW_DB_TEST_DATABASE_URL ?? ''

test('databaseService 통합', async (t) => {
  if (!isDbConfigured()) {
    t.skip('MEW_DB_TEST_DATABASE_URL 미설정 — 격리 Postgres 주소를 지정하세요')
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

  await t.test('createDatabase는 대표열·텍스트 열과 예시 2행을 저장한 managed DB를 만든다', async () => {
    const view = await svc.createDatabase(project, '  내 DB  ', 'tester@x.com')
    assert.equal(view.kind, 'managed')
    assert.equal(view.editable, true)
    assert.equal(view.title, '내 DB') // trim
    assert.deepEqual(view.columns.map(col => [col.name, col.type, !!col.primary]), [
      ['제목', 'text', true], ['텍스트', 'text', false],
    ])
    assert.deepEqual(view.rows.map(row => view.columns.map(col => row.cells[col.id])), [
      ['항목 1', '첫 번째 내용'], ['항목 2', '두 번째 내용'],
    ])
    assert.equal(new Set(view.rows.map(row => row.id)).size, 2)
    assert.deepEqual(view.rows.map(row => row.pos), [0, 1])
    assert.deepEqual((await svc.getView(project, view.id)).rows, view.rows)
    dbId = view.id
    firstColId = view.columns[0].id
    for (const row of view.rows) await svc.deleteRow(project, dbId, row.id)
  })

  await t.test('insertRow → getView에 필수 제목을 채운 행이 보인다', async () => {
    const row = await svc.insertRow(project, dbId)
    rowId = row.id
    const view = await svc.getView(project, dbId)
    assert.equal(view.rows.length, 1)
    assert.equal(view.rows[0].id, rowId)
    assert.equal(view.rows[0].cells[firstColId], '제목 없음')
  })

  await t.test('표 가져오기는 모든 열을 텍스트로 만들고 원래 값·행 순서를 보존한다', async () => {
    const table = { columns: ['이름', '숫자', '날짜'], rows: [['같음', '003', '2026-10-21'], ['같음', 'false', '첫째\n둘째'], ['', '', '']] }
    const imported = await svc.createDatabase(project, '가져온 표', null, undefined, table)
    assert.deepEqual(imported.columns.map(column => [column.name, column.type]), [['제목', 'text'], ['이름', 'text'], ['숫자', 'text'], ['날짜', 'text']])
    assert.deepEqual(imported.rows.map(row => imported.columns.map(column => row.cells[column.id])), table.rows.map((row, index) => [`항목 ${index + 1}`, ...row]))
    assert.deepEqual((await svc.getView(project, imported.id)).rows, imported.rows)
    const empty = await svc.createDatabase(project, '빈 표', null, undefined, { columns: ['A'], rows: [] })
    assert.equal(empty.columns.length, 1)
    assert.deepEqual(empty.rows, [])
    const before = await svc.listDatabases(project)
    await assert.rejects(svc.createDatabase(project, '잘못된 표', null, undefined, { columns: ['A'], rows: [['x', 'y']] }), svc.DbValidationError)
    assert.deepEqual(await svc.listDatabases(project), before)
  })

  await t.test('updateCell은 값을 저장하고 getView에 반영된다', async () => {
    await svc.updateCell(project, dbId, rowId, firstColId, '안녕')
    const view = await svc.getView(project, dbId)
    assert.equal(view.rows[0].cells[firstColId], '안녕')
  })

  await t.test('대표열은 필수·유일하며 삭제나 다른 타입 전환을 막는다', async () => {
    const second = await svc.insertRow(project, dbId)
    await assert.rejects(() => svc.updateCell(project, dbId, second.id, firstColId, '안녕'), svc.DbValidationError)
    await assert.rejects(() => svc.updateCell(project, dbId, rowId, firstColId, '  '), svc.DbValidationError)
    await assert.rejects(() => svc.deleteColumn(project, dbId, firstColId), svc.DbValidationError)
    await assert.rejects(() => svc.updateColumn(project, dbId, firstColId, { type: 'number' }), svc.DbValidationError)
    await assert.rejects(() => svc.addColumn(project, dbId, '페이지', 'page'), svc.DbValidationError)
    await svc.deleteRow(project, dbId, second.id)
  })

  await t.test('동시 행 추가도 서로 다른 기본 제목을 부여한다', async () => {
    const rows = await Promise.all(Array.from({ length: 5 }, () => svc.insertRow(project, dbId)))
    assert.equal(new Set(rows.map(row => row.cells[firstColId])).size, rows.length)
    for (const row of rows) await svc.deleteRow(project, dbId, row.id)
  })

  await t.test('기존 DB의 빈 제목·중복 제목은 기존 유효값을 보존하며 대표열 제약으로 이관한다', async () => {
    const legacy = await svc.createDatabase(project, '이전 DB', null)
    for (const row of legacy.rows) await svc.deleteRow(project, legacy.id, row.id)
    const { rows: metadata } = await exec<{ phys_schema: string; phys_table: string; pg_name: string }>(
      `SELECT d.phys_schema, d.phys_table, c.pg_name FROM mew.databases d JOIN mew.columns c ON c.database_id = d.id WHERE d.id = $1 AND c.id = $2`, [legacy.id, legacy.columns[0].id],
    )
    const info = metadata[0]
    const target = `${quoteIdent(info.phys_schema)}.${quoteIdent(info.phys_table)}`
    await exec(`ALTER TABLE ${target} DROP CONSTRAINT ${quoteIdent(`mew_primary_${info.pg_name}`)},
      DROP CONSTRAINT ${quoteIdent(`mew_required_${info.pg_name}`)}, ALTER COLUMN ${quoteIdent(info.pg_name)} DROP NOT NULL`)
    for (const [pos, title] of [null, '동일', '동일', '제목 없음'].entries()) {
      await exec(`INSERT INTO ${target} (pos, ${quoteIdent(info.pg_name)}) VALUES ($1, $2)`, [pos, title])
    }
    const migrated = await svc.getView(project, legacy.id)
    assert.deepEqual(migrated.rows.map(row => row.cells[legacy.columns[0].id]), ['제목 없음 (2)', '동일', '동일 (2)', '제목 없음'])
    assert.equal(migrated.columns[0].primary, true)
    await assert.rejects(() => svc.updateCell(project, legacy.id, migrated.rows[0].id, legacy.columns[0].id, '동일'), svc.DbValidationError)
    await svc.deleteDatabase(project, legacy.id)
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
    await assert.rejects(() => svc.updateCell(project, dbId, rowId, dt.id, '2026-02-30'), svc.DbValidationError)
    await assert.rejects(() => svc.updateCell(project, dbId, rowId, numColId, Infinity), svc.DbValidationError)
  })

  await t.test('단일선택·다중선택은 값을 보존하며 옵션을 저장하고 사용 중 옵션 삭제를 막는다', async () => {
    const col = await svc.addColumn(project, dbId, '상태', 'select', ['대기'])
    await svc.updateCell(project, dbId, rowId, col.id, '진행')
    let current = await svc.getView(project, dbId)
    assert.deepEqual(current.columns.find(c => c.id === col.id)?.options, ['대기', '진행'])
    assert.equal(current.rows[0].cells[col.id], '진행')
    await svc.updateColumn(project, dbId, col.id, { type: 'multi_select' })
    current = await svc.getView(project, dbId)
    assert.deepEqual(current.rows[0].cells[col.id], ['진행'])
    await svc.updateCell(project, dbId, rowId, col.id, ['진행', '완료'])
    await assert.rejects(() => svc.updateColumn(project, dbId, col.id, { type: 'select' }), svc.DbValidationError)
    await assert.rejects(() => svc.updateColumn(project, dbId, col.id, { options: ['대기', '진행'] }), svc.DbValidationError)
    current = await svc.getView(project, dbId)
    assert.equal(current.columns.find(c => c.id === col.id)?.type, 'multi_select')
    assert.deepEqual(current.rows[0].cells[col.id], ['진행', '완료'])
    await svc.updateCell(project, dbId, rowId, col.id, ['완료'])
    await svc.updateColumn(project, dbId, col.id, { type: 'select' })
    assert.equal((await svc.getView(project, dbId)).rows[0].cells[col.id], '완료')
  })

  await t.test('타입 전환은 유효하지 않은 값을 만나면 스키마와 모든 행을 보존한다', async () => {
    const col = await svc.addColumn(project, dbId, '변환', 'text')
    await svc.updateCell(project, dbId, rowId, col.id, '27')
    await svc.updateColumn(project, dbId, col.id, { type: 'number' })
    assert.equal((await svc.getView(project, dbId)).rows[0].cells[col.id], 27)
    await svc.updateColumn(project, dbId, col.id, { type: 'text' })
    const second = await svc.insertRow(project, dbId)
    await svc.updateCell(project, dbId, second.id, col.id, '아님')
    await assert.rejects(() => svc.updateColumn(project, dbId, col.id, { type: 'number' }), svc.DbValidationError)
    const current = await svc.getView(project, dbId)
    assert.equal(current.columns.find(c => c.id === col.id)?.type, 'text')
    assert.deepEqual(current.rows.map(row => row.cells[col.id]), ['27', '아님'])
    await svc.deleteRow(project, dbId, second.id)
  })

  await t.test('페이지 전환은 숫자 필드를 공유하며 양방향 편집과 제목·본문 보존을 지원한다', async (pageTest) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-db-row-pages-'))
    await fs.mkdir(path.join(root, project))
    try {
      await workspaceContext.run(pathsForWorkspace(root, 'tester@x.com'), async () => {
        await fs.mkdir(path.join(root, project, '문서'), { recursive: true })
        await fs.writeFile(path.join(root, project, '문서/사람.md'), '# 사람\n')
        const db = await svc.createDatabase(project, '사람', null, '문서/사람.md')
        const row = db.rows[0]
        const primary = db.columns[0].id
        await svc.updateCell(project, db.id, row.id, primary, '송상훈')
        const age = await svc.addColumn(project, db.id, '나이', 'number')
        await svc.updateCell(project, db.id, row.id, age.id, 27)
        await svc.updateColumn(project, db.id, primary, { type: 'page' })
        let current = await svc.getView(project, db.id)
        const pagePath = current.rows[0].pagePath!
        assert.equal(pagePath, '문서/사람/송상훈.md')
        assert.equal(current.ownerPath, '문서/사람/_사람.md')
        const absolute = path.join(root, project, pagePath)
        const initial = await fs.readFile(absolute, 'utf8')
        const properties = parse(initial.match(/^---\n([\s\S]*?)\n---/)![1])
        assert.equal(properties.title, '송상훈')
        assert.equal(properties.나이, 27)
        assert.equal(typeof properties.나이, 'number')
        assert.equal(properties.created, undefined)
        assert.equal(properties.updated, undefined)
        await fs.writeFile(absolute, initial.replace('나이: 27', '나이: 28') + '\n보존할 본문\n')
        current = await svc.getView(project, db.id)
        assert.equal(current.rows[0].cells[age.id], 28)
        await svc.updateCell(project, db.id, row.id, age.id, 29)
        assert.match(await fs.readFile(absolute, 'utf8'), /나이: 29/)
        await svc.updateCell(project, db.id, row.id, primary, '새 제목')
        assert.equal((await svc.getView(project, db.id)).rows[0].pagePath, pagePath)
        assert.match(await fs.readFile(absolute, 'utf8'), /title: 새 제목/)
        assert.match(await fs.readFile(absolute, 'utf8'), /보존할 본문/)
        await svc.renameColumn(project, db.id, age.id, '연령')
        const renamed = await fs.readFile(absolute, 'utf8')
        assert.match(renamed, /연령: 29/)
        assert.doesNotMatch(renamed, /나이:/)

        const second = await svc.insertRow(project, db.id)
        await svc.updateCell(project, db.id, second.id, primary, '다른 사람')
        const { rows: columnInfo } = await exec<{ phys_schema: string; phys_table: string; pg_name: string; id: string }>(
          `SELECT d.phys_schema, d.phys_table, c.pg_name, c.id FROM mew.databases d JOIN mew.columns c ON c.database_id = d.id WHERE d.id = $1`, [db.id],
        )
        const table = `${quoteIdent(columnInfo[0].phys_schema)}.${quoteIdent(columnInfo[0].phys_table)}`
        const primaryName = quoteIdent(columnInfo.find(column => column.id === primary)!.pg_name)
        const ageName = quoteIdent(columnInfo.find(column => column.id === age.id)!.pg_name)
        const rawRow = async () => (await exec<{ title: string; age: number }>(`SELECT ${primaryName} AS title, ${ageName} AS age FROM ${table} WHERE id = $1`, [row.id])).rows[0]

        await pageTest.test('다른 프로젝트의 디렉터리 별칭으로 행 페이지의 DB 권한을 우회할 수 없다', async () => {
          const other = `alias_${project}`
          const directory = path.join(root, other)
          await fs.mkdir(directory)
          await fs.symlink(path.dirname(absolute), path.join(directory, '연결'), 'dir')
          const baseline = await fs.readFile(absolute, 'utf8')
          try {
            await assert.rejects(() => saveDatabaseRowPage(other, `연결/${path.basename(pagePath)}`, baseline.replace('연령: 29', '연령: 77'), baseline, false),
              (error: unknown) => error instanceof RowPageError && error.status === 403)
          } finally { await fs.rm(directory, { recursive: true, force: true }) }
        })

        await pageTest.test('없어진 행 파일을 디렉터리 별칭으로 복원할 때도 DB 권한을 검사한다', async () => {
          const alias = path.join(root, project, '행별칭')
          const backup = path.join(root, 'page-backup.md')
          const baseline = await fs.readFile(absolute, 'utf8')
          await fs.symlink(path.dirname(absolute), alias, 'dir')
          await fs.rename(absolute, backup)
          try {
            await assert.rejects(() => saveDatabaseRowPage(project, `행별칭/${path.basename(pagePath)}`, baseline, baseline, false),
              (error: unknown) => error instanceof RowPageError && error.status === 403)
          } finally {
            await fs.rename(backup, absolute)
            await fs.unlink(alias)
          }
        })

        await pageTest.test('일반 이름으로 옮긴 페이지의 따옴표 YAML 연결 키도 DB 권한을 검사한다', async () => {
          const movedPath = '이름을 바꾼 페이지.md'
          const movedAbsolute = path.join(root, project, movedPath)
          await fs.rename(absolute, movedAbsolute)
          await remapDatabaseRowPages(project, [{ from: pagePath, to: movedPath }])
          try {
            const baseline = await fs.readFile(movedAbsolute, 'utf8')
            const quoted = baseline.replace('_mew_database:', '"_mew_database":')
            await saveDatabaseRowPage(project, movedPath, quoted, baseline)
            const canonical = await fs.readFile(movedAbsolute, 'utf8')
            assert.match(canonical, /"_mew_database":/)
            await assert.rejects(() => saveDatabaseRowPage(project, movedPath, canonical.replace('연령: 29', '연령: 77'), canonical, false),
              (error: unknown) => error instanceof RowPageError && error.status === 403)
          } finally {
            await fs.rename(movedAbsolute, absolute)
            await remapDatabaseRowPages(project, [{ from: movedPath, to: pagePath }])
          }
        })

        await pageTest.test('프론트매터의 빈 제목·중복 제목·여러 필드의 잘못된 수정은 전체 DB 변경을 되돌린다', async () => {
          const baseline = await fs.readFile(absolute, 'utf8')
          const events: DbEvent[] = []
          const unsubscribe = subscribeDb(project, db.id, event => events.push(event))
          try {
            for (const modified of [
              baseline.replace('title: 새 제목', 'title: ""'),
              baseline.replace('title: 새 제목', 'title: 다른 사람'),
              baseline.replace('title: 새 제목', 'title: 수정된 제목').replace('연령: 29', '연령: 숫자아님'),
            ]) {
              await fs.writeFile(absolute, modified)
              await assert.rejects(() => svc.getView(project, db.id), svc.DbValidationError)
              assert.deepEqual(await rawRow(), { title: '새 제목', age: 29 })
              assert.deepEqual(events, [])
            }
          } finally { unsubscribe(); await fs.writeFile(absolute, baseline) }
        })

        await pageTest.test('DB COMMIT 실패는 먼저 기록한 페이지 파일까지 복구한다', async () => {
          const baseline = await fs.readFile(absolute, 'utf8')
          const schema = quoteIdent(columnInfo[0].phys_schema)
          await exec(`CREATE FUNCTION ${schema}.reject_page_commit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'isolated commit failure'; END $$`)
          await exec(`CREATE CONSTRAINT TRIGGER reject_page_commit AFTER UPDATE ON ${table}
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_page_commit()`)
          try {
            await assert.rejects(() => svc.updateCell(project, db.id, row.id, age.id, 99), /isolated commit failure/)
            assert.deepEqual(await rawRow(), { title: '새 제목', age: 29 })
            assert.equal(await fs.readFile(absolute, 'utf8'), baseline)
          } finally { await exec(`DROP TRIGGER reject_page_commit ON ${table}`) }
        })

        await svc.updateColumn(project, db.id, primary, { type: 'text' })
        assert.match(await fs.readFile(absolute, 'utf8'), /보존할 본문/)
        assert.equal((await svc.getView(project, db.id)).rows[0].pagePath, undefined)
        await svc.updateColumn(project, db.id, primary, { type: 'page' })
        assert.equal((await svc.getView(project, db.id)).rows[0].pagePath, pagePath)
        assert.match(await fs.readFile(absolute, 'utf8'), /보존할 본문/)
        await svc.deleteDatabase(project, db.id)
      })
    } finally { await fs.rm(root, { recursive: true, force: true }) }
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
