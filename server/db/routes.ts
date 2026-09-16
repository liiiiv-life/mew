// /db REST 라우트 — 데이터베이스 뷰의 생성/조회/편집. 변경은 전부 인증 사용자만(마운트 시 requireAuthenticated).
// 실제 오케스트레이션은 databaseService가 하고, 여기서는 요청 파싱 + 프로젝트 스코프 + 에러 → HTTP 매핑만 한다.
import express from 'express'
import { DEFAULT_PROJECT } from '../paths.ts'
import { authOf } from '../reqAuth.ts'
import { canUse, unrestrictedFiles } from '../access-policy.ts'
import { DbNotConfiguredError } from './pool.ts'
import { InvalidIdentifierError } from './identifiers.ts'
import type { ColumnType } from './schema.ts'
import * as svc from './databaseService.ts'

// 프로젝트명은 클라이언트 detectProject와 동일 규칙 — 네임스페이스를 이 형태로 한정한다.
const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 요청의 대상 프로젝트 — 쿼리(GET/DELETE) 또는 바디(POST/PATCH), 없으면 docs */
function projectOf(req: express.Request): string {
  const fromQuery = req.query.project
  if (typeof fromQuery === 'string' && PROJECT_RE.test(fromQuery)) return fromQuery
  const fromBody = (req.body as { project?: unknown } | null | undefined)?.project
  if (typeof fromBody === 'string' && PROJECT_RE.test(fromBody)) return fromBody
  return DEFAULT_PROJECT
}

/** :id 가 uuid 형태가 아니면 곧장 404 — 잘못된 형식을 Postgres uuid 캐스팅 에러(500)로 흘리지 않는다 */
function requireUuid(res: express.Response, id: string): boolean {
  if (UUID_RE.test(id)) return true
  res.status(404).json({ error: '데이터베이스를 찾을 수 없습니다' })
  return false
}

function handleDbError(res: express.Response, err: unknown) {
  if (err instanceof DbNotConfiguredError) {
    res.status(503).json({ error: '데이터베이스가 구성되지 않았습니다 (Postgres 미기동)' })
    return
  }
  if (err instanceof svc.DbObjectNotFoundError) {
    res.status(404).json({ error: err.message })
    return
  }
  if (err instanceof svc.DbReadOnlyError) {
    res.status(403).json({ error: err.message })
    return
  }
  if (err instanceof svc.DbValidationError || err instanceof InvalidIdentifierError) {
    res.status(400).json({ error: err.message })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Internal error' })
}

export function createDbRouter(): express.Router {
  const r = express.Router()
  r.use((req, res, next) => {
    if (!canUse(authOf(req), 'database') || !unrestrictedFiles(authOf(req), projectOf(req), !['GET', 'HEAD'].includes(req.method))) {
      res.status(403).json({ error: '파일 접근 권한이 없습니다' }); return
    }
    next()
  })

  // 목록
  r.get('/', async (req, res) => {
    try {
      res.json(await svc.listDatabases(projectOf(req)))
    } catch (err) {
      handleDbError(res, err)
    }
  })

  // managed 데이터베이스 생성
  r.post('/', async (req, res) => {
    const { title } = req.body as { title?: unknown }
    try {
      const view = await svc.createDatabase(projectOf(req), typeof title === 'string' ? title : '', authOf(req).email)
      res.json(view)
    } catch (err) {
      handleDbError(res, err)
    }
  })

  // 기존 테이블을 external(읽기 전용)로 참조
  r.post('/attach', async (req, res) => {
    const { schema, table, title } = req.body as { schema?: unknown; table?: unknown; title?: unknown }
    try {
      if (typeof schema !== 'string' || !schema || typeof table !== 'string' || !table) {
        res.status(400).json({ error: 'schema와 table이 필요합니다' })
        return
      }
      const view = await svc.attachExternal(
        projectOf(req),
        schema,
        table,
        typeof title === 'string' ? title : null,
        authOf(req).email,
      )
      res.json(view)
    } catch (err) {
      handleDbError(res, err)
    }
  })

  // 단일 뷰(컬럼 + 행)
  r.get('/:id', async (req, res) => {
    if (!requireUuid(res, req.params.id)) return
    try {
      res.json(await svc.getView(projectOf(req), req.params.id))
    } catch (err) {
      handleDbError(res, err)
    }
  })

  // 제목 변경 (카탈로그 라벨 — managed/external 모두 가능)
  r.patch('/:id', async (req, res) => {
    if (!requireUuid(res, req.params.id)) return
    const { title } = req.body as { title?: unknown }
    try {
      if (typeof title !== 'string') {
        res.status(400).json({ error: 'title이 필요합니다' })
        return
      }
      res.json(await svc.renameDatabase(projectOf(req), req.params.id, title))
    } catch (err) {
      handleDbError(res, err)
    }
  })

  // 데이터베이스 삭제 (managed는 물리 테이블까지, external은 참조만 해제)
  r.delete('/:id', async (req, res) => {
    if (!requireUuid(res, req.params.id)) return
    try {
      await svc.deleteDatabase(projectOf(req), req.params.id)
      res.json({ ok: true })
    } catch (err) {
      handleDbError(res, err)
    }
  })

  // 행 추가
  r.post('/:id/rows', async (req, res) => {
    if (!requireUuid(res, req.params.id)) return
    try {
      res.json(await svc.insertRow(projectOf(req), req.params.id))
    } catch (err) {
      handleDbError(res, err)
    }
  })

  // 셀 값 수정
  r.patch('/:id/rows/:rowId', async (req, res) => {
    if (!requireUuid(res, req.params.id)) return
    const { columnId, value } = req.body as { columnId?: unknown; value?: unknown }
    try {
      if (typeof columnId !== 'string' || !columnId) {
        res.status(400).json({ error: 'columnId가 필요합니다' })
        return
      }
      const saved = await svc.updateCell(projectOf(req), req.params.id, req.params.rowId, columnId, value)
      res.json({ value: saved })
    } catch (err) {
      handleDbError(res, err)
    }
  })

  // 행 삭제
  r.delete('/:id/rows/:rowId', async (req, res) => {
    if (!requireUuid(res, req.params.id)) return
    try {
      await svc.deleteRow(projectOf(req), req.params.id, req.params.rowId)
      res.json({ ok: true })
    } catch (err) {
      handleDbError(res, err)
    }
  })

  // 컬럼 추가
  r.post('/:id/columns', async (req, res) => {
    if (!requireUuid(res, req.params.id)) return
    const { name, type } = req.body as { name?: unknown; type?: unknown }
    try {
      const col = await svc.addColumn(
        projectOf(req),
        req.params.id,
        typeof name === 'string' ? name : '',
        type as ColumnType,
      )
      res.json(col)
    } catch (err) {
      handleDbError(res, err)
    }
  })

  // 컬럼 이름 변경
  r.patch('/:id/columns/:columnId', async (req, res) => {
    if (!requireUuid(res, req.params.id)) return
    const { name } = req.body as { name?: unknown }
    try {
      const col = await svc.renameColumn(projectOf(req), req.params.id, req.params.columnId, typeof name === 'string' ? name : '')
      res.json(col)
    } catch (err) {
      handleDbError(res, err)
    }
  })

  // 컬럼 삭제
  r.delete('/:id/columns/:columnId', async (req, res) => {
    if (!requireUuid(res, req.params.id)) return
    try {
      await svc.deleteColumn(projectOf(req), req.params.id, req.params.columnId)
      res.json({ ok: true })
    } catch (err) {
      handleDbError(res, err)
    }
  })

  return r
}
