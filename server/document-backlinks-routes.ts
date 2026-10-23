import express from 'express'
import path from 'node:path'
import fs from 'node:fs/promises'
import { DocumentLinkIndex } from './document-link-index.ts'
import { DocumentBacklinkIndex } from './document-backlinks.ts'
import { authOf, requireFeature } from './reqAuth.ts'
import { canUse, fileAccess } from './access-policy.ts'
import { DEFAULT_PROJECT, WORKSPACE_PROJECT, isDeniedSegment, listProjects, pathsForWorkspace, resolveProjectPath, workspaceContext, workspacePaths } from './paths.ts'
import { readRootProjects } from './userUiState.ts'

export function createDocumentBacklinksRouter(links = new DocumentLinkIndex()): express.Router {
  const router = express.Router(), index = new DocumentBacklinkIndex(links)
  router.get('/docs/backlinks', requireFeature('filesRead'), async (req, res) => {
    try {
      const auth = authOf(req), active = workspacePaths.root
      const project = typeof req.query.project === 'string' ? req.query.project : DEFAULT_PROJECT
      const input = req.query.path
      if (typeof input !== 'string' || !input || input.includes('\0')) { res.status(400).json({ error: '문서 경로가 필요합니다' }); return }
      const external = path.isAbsolute(input)
      if (external && !canUse(auth, 'serverFiles')) { res.status(403).json({ error: '서버 파일 접근 권한이 필요합니다' }); return }
      const target = external ? input : resolveProjectPath(project, input)
      const roots = [active, ...(canUse(auth, 'serverFiles') && auth.email ? readRootProjects(auth.email)?.paths ?? [] : [])]
      const scopes = await Promise.all([...new Set(roots)].map(async root => {
        try {
          const real = await fs.realpath(root), context = pathsForWorkspace(real, auth.email)
          const projects = workspaceContext.run(context, () => new Set(listProjects()))
          const docs = await fs.realpath(context.docsRoot).catch(() => context.docsRoot)
          return { root: real, docs, context, projects }
        } catch { return null }
      }))
      const readable = (absolute: string): boolean => {
        if (absolute.split(path.sep).some(isDeniedSegment)) return false
        const scope = scopes.filter(scope => scope && (absolute === scope.root || absolute.startsWith(scope.root + path.sep) || absolute.startsWith(scope.docs + path.sep))).sort((a, b) => b!.root.length - a!.root.length)[0]
        if (!scope) return false
        return workspaceContext.run(scope.context, () => {
          const docs = scope.docs
          if (absolute.startsWith(docs + path.sep)) return fileAccess(auth, DEFAULT_PROJECT, path.relative(docs, absolute)).view
          const relative = path.relative(scope.root, absolute), [first, ...rest] = relative.split(path.sep)
          return fileAccess(auth, scope.projects.has(first) ? first : WORKSPACE_PROJECT, scope.projects.has(first) ? rest.join('/') : relative).view
        })
      }
      const realTarget = await fs.realpath(target)
      const parentReadable = (absolute: string) => {
        const known = scopes.some(scope => scope && (absolute.startsWith(scope.root + path.sep) || absolute.startsWith(scope.docs + path.sep)))
        return known ? readable(absolute) : canUse(auth, 'serverFiles') && !absolute.split(path.sep).some(isDeniedSegment)
      }
      const targetReadable = () => external ? parentReadable(realTarget) : readable(realTarget)
      if (!targetReadable() || !external && !fileAccess(auth, project, input).view) { res.status(403).json({ error: '파일 열람 권한이 없습니다' }); return }
      if (!(await fs.stat(realTarget)).isFile()) { res.status(400).json({ error: '문서 파일을 선택하세요' }); return }
      const result = await index.read(realTarget, scopes.flatMap(scope => scope ? [scope.root, scope.docs] : []), readable, parentReadable)
      if (!targetReadable()) { res.status(403).json({ error: '파일 열람 권한이 없습니다' }); return }
      res.set('Cache-Control', 'no-store').json(result)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      res.status(code === 'ENOENT' ? 404 : code === 'EACCES' ? 403 : 400).json({ error: code === 'ENOENT' ? '문서를 찾을 수 없습니다' : '백링크를 불러오지 못했습니다' })
    }
  })
  return router
}
