// /db REST 라우트 통합 테스트 — 실제 Postgres 필요. DATABASE_URL이 없거나 접속 불가하면 통째로 skip.
// 라우터를 bare express 앱에 마운트하고(인증은 스텁), 임시 포트로 띄워 fetch로 두드린다.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathsForWorkspace, workspaceContext } from '../paths.ts'
import { isDbConfigured, exec, closePool } from './pool.ts'
import { quoteIdent, projectSchema } from './identifiers.ts'
import { createDbRouter } from './routes.ts'

process.env.DATABASE_URL = process.env.MEW_DB_TEST_DATABASE_URL ?? ''

test('db routes 통합', async (t) => {
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-db-routes-'))
  await fs.mkdir(path.join(root, project))
  await fs.mkdir(path.join(root, 'other_zzz'))
  const app = express()
  app.use(express.json())
  // 인증 스텁 — 실서버에선 requireAuthenticated + attachAuthContext가 채운다
  app.use((req, _res, next) => {
    ;(req as express.Request & { auth?: unknown }).auth = { role: 'owner', email: 'tester@x.com', mustChangePassword: false }
    workspaceContext.run(pathsForWorkspace(root, 'tester@x.com'), next)
  })
  app.use('/db', createDbRouter())
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}/db` : ''

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    // 테스트 응답 바디는 라우트마다 형태가 달라(객체/배열) 편의상 느슨하게 다룬다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = (await res.json().catch(() => null)) as any
    return { status: res.status, json: payload as any }
  }

  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    try {
      await exec(`DROP SCHEMA IF EXISTS ${quoteIdent(projectSchema(project))} CASCADE`)
      await exec(`DELETE FROM mew.databases WHERE project = $1`, [project])
    } catch {
      // 정리 실패 무시 (매번 랜덤 프로젝트)
    }
    await closePool()
    await fs.rm(root, { recursive: true, force: true })
  })

  let dbId = ''
  let colId = ''
  let rowId = ''

  await t.test('POST /db → 201 아닌 200 + managed 뷰', async () => {
    const { status, json } = await call('POST', '/', { project, title: '작업 목록' })
    assert.equal(status, 200)
    assert.equal(json.kind, 'managed')
    assert.equal(json.editable, true)
    assert.equal(json.title, '작업 목록')
    assert.equal(json.columns.length, 2)
    assert.equal(json.columns[1].name, '텍스트')
    assert.equal(json.columns[1].type, 'text')
    assert.equal(json.rows.length, 2)
    dbId = json.id
    colId = json.columns[0].id
    assert.deepEqual(json.rows.map((row: { cells: Record<string, string> }) => json.columns.map((col: { id: string }) => row.cells[col.id])), [
      ['항목 1', '첫 번째 내용'], ['항목 2', '두 번째 내용'],
    ])
  })

  await t.test('GET /db → 방금 만든 DB가 목록에 있다', async () => {
    const { status, json } = await call('GET', `/?project=${project}`)
    assert.equal(status, 200)
    assert.ok(json.some((d: { id: string }) => d.id === dbId))
  })

  await t.test('표 가져오기는 원본 텍스트를 저장하고 전체 행 조회는 기본 표시 한도를 넘긴다', async () => {
    const table = { columns: ['Name', 'Value'], rows: Array.from({ length: 1001 }, (_, index) => [`row${index}`, '003']) }
    const imported = await call('POST', '/', { project, title: 'Imported', table })
    assert.equal(imported.status, 200)
    assert.deepEqual(imported.json.columns.map((column: { name: string; type: string }) => [column.name, column.type]), [['Name', 'text'], ['Value', 'text']])
    assert.equal(imported.json.rows.length, 1001)
    const normal = await call('GET', `/${imported.json.id}?project=${project}`)
    const full = await call('GET', `/${imported.json.id}?project=${project}&allRows=true`)
    assert.equal(normal.json.rows.length, 1000)
    assert.equal(full.json.rows.length, 1001)
    assert.equal(full.json.rows[1000].cells[full.json.columns[1].id], '003')
    assert.equal((await call('GET', `/${imported.json.id}?project=other_zzz&allRows=true`)).status, 404)
    assert.equal((await call('POST', '/', { project, title: 'Invalid', table: { columns: ['A'], rows: [['a', 'b']] } })).status, 400)
  })

  await t.test('POST /db/:id/rows + PATCH cell → GET에 반영', async () => {
    const ins = await call('POST', `/${dbId}/rows`, { project })
    assert.equal(ins.status, 200)
    rowId = ins.json.id
    const patch = await call('PATCH', `/${dbId}/rows/${rowId}`, { project, columnId: colId, value: '첫 행' })
    assert.equal(patch.status, 200)
    assert.equal(patch.json.value, '첫 행')
    const view = await call('GET', `/${dbId}?project=${project}`)
    assert.equal(view.json.rows.find((row: { id: string }) => row.id === rowId).cells[colId], '첫 행')
  })

  await t.test('POST /db/:id/columns(number) + 잘못된 값은 400', async () => {
    const add = await call('POST', `/${dbId}/columns`, { project, name: '점수', type: 'number' })
    assert.equal(add.status, 200)
    assert.equal(add.json.type, 'number')
    const bad = await call('PATCH', `/${dbId}/rows/${rowId}`, { project, columnId: add.json.id, value: '숫자아님' })
    assert.equal(bad.status, 400)
  })

  await t.test('알 수 없는 컬럼 타입은 400', async () => {
    const { status } = await call('POST', `/${dbId}/columns`, { project, name: 'x', type: 'bogus' })
    assert.equal(status, 400)
  })

  await t.test('PATCH 열 타입·선택 옵션과 대표열 제약을 처리한다', async () => {
    const add = await call('POST', `/${dbId}/columns`, { project, name: '상태', type: 'select', options: ['대기', '완료'] })
    assert.equal(add.status, 200)
    assert.deepEqual(add.json.options, ['대기', '완료'])
    const patch = await call('PATCH', `/${dbId}/columns/${add.json.id}`, { project, type: 'multi_select' })
    assert.equal(patch.status, 200)
    assert.equal(patch.json.type, 'multi_select')
    const options = await call('PATCH', `/${dbId}/columns/${add.json.id}`, { project, options: ['진행', '완료'] })
    assert.equal(options.status, 200)
    assert.deepEqual(options.json.options, ['진행', '완료'])
    const color = await call('PATCH', `/${dbId}/columns/${add.json.id}/option`, { project, option: '진행', hue: 210 })
    assert.equal(color.status, 200)
    assert.equal(color.json.optionColors.진행, 210)
    const renamed = await call('PATCH', `/${dbId}/columns/${add.json.id}/option`, { project, option: '진행', name: '진행 중' })
    assert.equal(renamed.status, 200)
    assert.deepEqual(renamed.json.options, ['진행 중', '완료'])
    assert.equal(renamed.json.optionColors['진행 중'], 210)
    assert.equal((await call('PATCH', `/${dbId}/columns/${add.json.id}/option`, { project, option: '진행 중', hue: 999 })).status, 400)
    const deleted = await call('PATCH', `/${dbId}/columns/${add.json.id}/option`, { project, option: '진행 중', remove: true })
    assert.equal(deleted.status, 200)
    assert.deepEqual(deleted.json.options, ['완료'])
    assert.equal((await call('PATCH', `/${dbId}/columns/${colId}`, { project, type: 'number' })).status, 400)
    assert.equal((await call('DELETE', `/${dbId}/columns/${colId}?project=${project}`)).status, 400)
    assert.equal((await call('PATCH', `/${dbId}/rows/${rowId}`, { project, columnId: colId, value: '' })).status, 400)
  })

  await t.test('페이지 전환 응답은 소유 문서 전환과 열린 탭 보정 경로를 포함한다', async () => {
    await fs.writeFile(path.join(root, project, 'Books.md'), '# Books\n')
    const created = await call('POST', '/', { project, title: '책', ownerPath: 'Books.md' })
    const primary = created.json.columns[0].id
    const converted = await call('PATCH', `/${created.json.id}/columns/${primary}`, { project, type: 'page' })
    assert.equal(converted.status, 200)
    assert.deepEqual(converted.json.documentPageMutations[0].moves, [{ from: 'Books.md', to: 'Books/_Books.md' }])
    const loaded = await call('GET', `/${created.json.id}?project=${project}`)
    assert.equal(loaded.json.ownerPath, 'Books/_Books.md')
    assert.deepEqual(loaded.json.rows.map((row: { pagePath: string }) => row.pagePath), ['Books/항목 1.md', 'Books/항목 2.md'])
    assert.equal(loaded.json.documentPageMutations, undefined, 'unchanged reads do not replay an earlier mutation')
  })

  await t.test('없는 DB 조회는 404, uuid 아닌 id도 404', async () => {
    const missing = await call('GET', `/00000000-0000-0000-0000-000000000000?project=${project}`)
    assert.equal(missing.status, 404)
    const malformed = await call('GET', `/not-a-uuid?project=${project}`)
    assert.equal(malformed.status, 404)
  })

  await t.test('다른 프로젝트에서는 같은 id도 404 (격리)', async () => {
    const { status } = await call('GET', `/${dbId}?project=other_zzz`)
    assert.equal(status, 404)
  })

  await t.test('external 참조는 편집 시 403', async () => {
    const schema = projectSchema(project)
    await exec(`CREATE TABLE ${quoteIdent(schema)}.ext_src (name text, qty integer)`)
    await exec(`INSERT INTO ${quoteIdent(schema)}.ext_src (name, qty) VALUES ('사과', 3)`)
    const attach = await call('POST', '/attach', { project, schema, table: 'ext_src', title: '재고' })
    assert.equal(attach.status, 200)
    assert.equal(attach.json.editable, false)
    const write = await call('POST', `/${attach.json.id}/rows`, { project })
    assert.equal(write.status, 403)
  })

  await t.test('PATCH /db/:id → 제목 변경이 GET에 반영', async () => {
    const patch = await call('PATCH', `/${dbId}`, { project, title: '이름 바뀐 목록' })
    assert.equal(patch.status, 200)
    assert.equal(patch.json.title, '이름 바뀐 목록')
    const view = await call('GET', `/${dbId}?project=${project}`)
    assert.equal(view.json.title, '이름 바뀐 목록')
    const bad = await call('PATCH', `/${dbId}`, { project })
    assert.equal(bad.status, 400)
  })

  await t.test('DELETE /db/:id/rows + DELETE /db/:id', async () => {
    const del = await call('DELETE', `/${dbId}/rows/${rowId}?project=${project}`)
    assert.equal(del.status, 200)
    const delDb = await call('DELETE', `/${dbId}?project=${project}`)
    assert.equal(delDb.status, 200)
    const gone = await call('GET', `/${dbId}?project=${project}`)
    assert.equal(gone.status, 404)
  })
})
