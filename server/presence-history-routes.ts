import express from 'express'
import { authOf, requireAuthenticated } from './reqAuth.ts'
import { HistoryQueryError, parseHistoryRange, readPresenceHistory } from './presence-history.ts'
import { sessionHistoryXlsx } from './session-history-xlsx.ts'

export function createPresenceHistoryRouter() {
  const router = express.Router()
  router.use(requireAuthenticated)
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    if (authOf(req).mustChangePassword) { res.status(403).json({ error: 'Authentication required' }); return }
    next()
  })
  router.get(['/', '/export'], (req, res) => {
    try {
      const range = parseHistoryRange(req.query)
      const history = readPresenceHistory(range, authOf(req))
      if (req.path === '/export') {
        res.setHeader('Content-Disposition', `attachment; filename="mew-sessions-${range.from}.xlsx"`)
        res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(sessionHistoryXlsx(history.records))
      } else res.json(history)
    } catch (error) {
      if (error instanceof HistoryQueryError) res.status(400).json({ error: error.message })
      else { console.error('[mew:presence] History query failed', error); res.status(503).json({ error: 'Session history is unavailable' }) }
    }
  })
  return router
}
