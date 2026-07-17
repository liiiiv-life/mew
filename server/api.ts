import express from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import { resolveDocsPath, toRelativePath, UnsafePathError, DOCS_ROOT } from './paths'
import { buildTree } from './tree'
import { commitFile } from './git'
import { evaluateRules, isArchived } from './rules'
import { createDocument, createFolder, renamePath, deletePath, ConflictError } from './documents'
import { uploadAsset, R2NotConfiguredError } from './r2'
import { agentChat, getAgentSessionMessages, listAgentModels, listAgentSessions, listAgentSkills, type AgentProvider } from './agent'
import { createTmuxSession, killTmuxSession, listTmuxSessions, renameTmuxSession, TmuxError } from './tmux'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } })

function parseProvider(value: unknown): AgentProvider {
  return value === 'claude' ? 'claude' : 'hermes'
}

export function createApiApp(opts: { readOnly?: boolean } = {}) {
  const readOnly = opts.readOnly ?? false
  const app = express()
  app.use(express.json({ limit: '10mb' }))

  // 뷰어 모드: 문서 조회 GET만 허용 (agent 세션 등은 게스트에게 노출하지 않음)
  if (readOnly) {
    const allowed = new Set(['/mode', '/tree', '/file', '/rules'])
    app.use((req, res, next) => {
      if (req.method === 'GET' && allowed.has(req.path)) {
        next()
        return
      }
      res.status(403).json({ error: '뷰어 모드입니다 — 수정할 수 없습니다' })
    })
  }

  app.get('/mode', (_req, res) => {
    res.json({ readOnly })
  })

  app.get('/tree', (_req, res) => {
    res.json(buildTree())
  })

  app.get('/file', (req, res) => {
    const relPath = String(req.query.path ?? '')
    try {
      const absPath = resolveDocsPath(relPath)
      const content = fs.readFileSync(absPath, 'utf-8')
      res.json({ path: relPath, content })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/file', async (req, res) => {
    const { path: relPath, content, commit } = req.body as { path: string; content: string; commit?: boolean }
    try {
      resolveDocsPath(relPath)
      if (isArchived(relPath)) {
        res.status(403).json({ error: 'archives/ 문서는 불변입니다 — 편집할 수 없습니다' })
        return
      }
      const absPath = resolveDocsPath(relPath)
      fs.mkdirSync(path.dirname(absPath), { recursive: true })
      const isNew = !fs.existsSync(absPath)
      fs.writeFileSync(absPath, content, 'utf-8')
      if (commit) {
        const result = await commitFile(relPath, isNew ? 'add' : 'update')
        res.json({ ok: true, commit: result })
      } else {
        res.json({ ok: true, commit: null })
      }
    } catch (err) {
      handleError(res, err)
    }
  })

  app.delete('/file', async (req, res) => {
    const relPath = String(req.query.path ?? '')
    try {
      resolveDocsPath(relPath)
      if (isArchived(relPath)) {
        res.status(403).json({ error: 'archives/ 문서는 삭제할 수 없습니다' })
        return
      }
      deletePath(relPath)
      // 빈 디렉터리처럼 git이 전혀 알지 못하는 경로는 git add가 pathspec 오류를 던진다 —
      // 디스크 삭제 자체는 이미 끝났으므로 커밋 실패로 전체 요청을 실패시키지 않는다.
      let commit = null
      try {
        commit = await commitFile(relPath, 'delete', `docs: delete ${relPath}`)
      } catch (err) {
        console.error('delete commit failed:', err)
      }
      res.json({ ok: true, commit })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/rename', async (req, res) => {
    const { oldPath, newPath } = req.body as { oldPath: string; newPath: string }
    try {
      resolveDocsPath(oldPath)
      resolveDocsPath(newPath)
      if (isArchived(oldPath) || isArchived(newPath)) {
        res.status(403).json({ error: 'archives/ 문서는 이름을 바꿀 수 없습니다' })
        return
      }
      if (oldPath.endsWith('.md') && !newPath.endsWith('.md')) {
        res.status(400).json({ error: '.md 파일만 이름을 바꿀 수 있습니다' })
        return
      }
      renamePath(oldPath, newPath)
      const commit = await commitFile([oldPath, newPath], 'rename', `docs: rename ${oldPath} → ${newPath}`)
      res.json({ ok: true, relPath: newPath, commit })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/new-folder', (req, res) => {
    const { relPath } = req.body as { relPath: string }
    try {
      resolveDocsPath(relPath)
      if (isArchived(relPath)) {
        res.status(403).json({ error: 'archives/ 밑에는 새 폴더를 만들 수 없습니다' })
        return
      }
      createFolder(relPath)
      res.json({ ok: true, relPath })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/rules', (req, res) => {
    const relPath = String(req.query.path ?? '')
    try {
      resolveDocsPath(relPath)
      res.json(evaluateRules(relPath))
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/upload', upload.single('file'), async (req, res) => {
    const file = req.file
    if (!file) {
      res.status(400).json({ error: '파일이 없습니다' })
      return
    }
    try {
      const url = await uploadAsset(file.buffer, file.originalname, file.mimetype)
      res.json({ url, name: file.originalname, mimetype: file.mimetype })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/new-document', async (req, res) => {
    const { relPath, title } = req.body as { relPath: string; title: string }
    try {
      resolveDocsPath(relPath)
      if (isArchived(relPath)) {
        res.status(403).json({ error: 'archives/ 밑에는 새 문서를 만들 수 없습니다' })
        return
      }
      if (!relPath.endsWith('.md')) {
        res.status(400).json({ error: '.md 파일만 생성할 수 있습니다' })
        return
      }
      if (!title.trim()) {
        res.status(400).json({ error: '제목을 입력하세요' })
        return
      }
      createDocument(relPath, title)
      const commit = await commitFile(relPath, 'add')
      res.json({ ok: true, relPath, commit })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/agent-chat', async (req, res) => {
    const { message, sessionId, skill, model, provider } = req.body as {
      message: string
      sessionId?: string
      skill?: string
      model?: string
      provider?: AgentProvider
    }
    if (!message?.trim()) {
      res.status(400).json({ error: '메시지를 입력하세요' })
      return
    }
    try {
      const { text, sessionId: resultSessionId } = await agentChat(message, {
        sessionId: sessionId || undefined,
        skill: skill || undefined,
        model: model || undefined,
        provider,
      })
      res.json({ ok: true, response: text, sessionId: resultSessionId })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/agent-sessions', (req, res) => {
    try {
      res.json(listAgentSessions(parseProvider(req.query.provider)))
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/agent-messages', (req, res) => {
    const sessionId = String(req.query.id ?? '')
    if (!sessionId) {
      res.status(400).json({ error: '세션 ID가 없습니다' })
      return
    }
    try {
      res.json(getAgentSessionMessages(parseProvider(req.query.provider), sessionId))
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/agent-skills', (req, res) => {
    try {
      res.json(listAgentSkills(parseProvider(req.query.provider)))
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/agent-models', (req, res) => {
    try {
      res.json(listAgentModels(parseProvider(req.query.provider)))
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/tmux/sessions', async (_req, res) => {
    try {
      res.json(await listTmuxSessions())
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/tmux/sessions', async (req, res) => {
    const { name } = req.body as { name: string }
    try {
      await createTmuxSession(name)
      res.json({ ok: true, name })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.delete('/tmux/sessions/:name', async (req, res) => {
    try {
      await killTmuxSession(req.params.name)
      res.json({ ok: true })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/tmux/sessions/:name/rename', async (req, res) => {
    const { newName } = req.body as { newName: string }
    try {
      await renameTmuxSession(req.params.name, newName)
      res.json({ ok: true, name: newName })
    } catch (err) {
      handleError(res, err)
    }
  })

  return app
}

function handleError(res: express.Response, err: unknown) {
  if (err instanceof UnsafePathError) {
    res.status(400).json({ error: err.message })
    return
  }
  if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message })
    return
  }
  if (err instanceof R2NotConfiguredError) {
    res.status(503).json({ error: err.message })
    return
  }
  if (err instanceof TmuxError) {
    res.status(400).json({ error: err.message })
    return
  }
  if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
    res.status(404).json({ error: 'Not found' })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Internal error' })
}

export { DOCS_ROOT, toRelativePath }
