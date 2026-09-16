import express from 'express'
import fs from 'node:fs'
import { listUsers, getUser, userProfile } from './auth.ts'
import { requireRole } from './reqAuth.ts'
import { capabilitiesFor, featureOverrides, fileAccess, fileRules, policyPath, setFeature, setFileRule, workspaceScope } from './access-policy.ts'
import { resolveProjectPath } from './paths.ts'
import { listCatalogChildren } from './fileCatalog.ts'
import { FEATURES, type Feature } from '../shared/access-policy.ts'

function rows() {
  return [
    ...listUsers().map(({ email, record }) => ({ subject: email, role: record.role, displayName: userProfile(email, record).displayName })),
    { subject: 'guest', role: 'guest' as const, displayName: 'guest' },
  ].map(row => ({ ...row, capabilities: capabilitiesFor({ role: row.role, email: row.subject === 'guest' ? null : row.subject, mustChangePassword: false }), overrides: featureOverrides(row.subject) }))
}
export function createAccessRouter() {
  const router = express.Router()
  router.use(requireRole('owner'))
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.get('/', (_req, res) => { res.json({ rows: rows(), workspace: workspaceScope() }) })
  router.put('/feature', (req, res) => {
    const { subject, feature, enabled } = req.body ?? {}
    if (typeof subject !== 'string' || (subject !== 'guest' && !getUser(subject)) || !FEATURES.includes(feature) || (enabled !== null && typeof enabled !== 'boolean')) {
      res.status(400).json({ error: '계정과 기능 권한을 확인하세요' }); return
    }
    try { setFeature(subject, feature as Feature, enabled); res.json({ rows: rows(), workspace: workspaceScope() }) }
    catch (error) { res.status(400).json({ error: (error as Error).message }) }
  })
  router.get('/path', async (req, res) => {
    const project = String(req.query.project ?? '.workspace'), relPath = String(req.query.path ?? '')
    try {
      const canonicalPath = policyPath(project, relPath), target = resolveProjectPath(project, relPath)
      const directory = fs.statSync(target).isDirectory()
      const entries = directory ? (await listCatalogChildren(project, relPath, { showAll: true })).entries : []
      const permissions = rows().map(row => ({ subject: row.subject,
        explicit: fileRules(row.subject).find(rule => rule.path === canonicalPath) ?? null,
        effective: fileAccess({ role: row.role, email: row.subject === 'guest' ? null : row.subject, mustChangePassword: false }, project, relPath),
      }))
      res.json({ workspace: workspaceScope(), project, path: relPath, directory, entries, permissions })
    } catch (error) { res.status(400).json({ error: (error as Error).message }) }
  })
  router.put('/path', (req, res) => {
    const { subject, project, path: relPath, access, workspace } = req.body ?? {}
    if (typeof subject !== 'string' || (subject !== 'guest' && !getUser(subject)) || typeof project !== 'string' || typeof relPath !== 'string') {
      res.status(400).json({ error: '계정과 파일 경로를 확인하세요' }); return
    }
    if (workspace !== workspaceScope()) { res.status(409).json({ error: '프로젝트가 변경되었습니다. 설정 창을 다시 여세요.' }); return }
    try { setFileRule(subject, project, relPath, access); res.json({ ok: true }) }
    catch (error) { res.status(400).json({ error: (error as Error).message }) }
  })
  return router
}
