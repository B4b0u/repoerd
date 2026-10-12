import { apiPaths, type SetupStatusResponse } from '@repoerd/contracts'
import { safeNextPath } from '../../domain/redirect.js'
import type { AppHono } from '../types.js'

/** GITHUB_MODE=fake: no setup and no OAuth (spec §12). */
export function registerFakeModeRoutes(app: AppHono) {
  app.get(apiPaths.setupStatus, (c) =>
    c.json({
      mode: 'fake',
      state: 'ready',
      unlocked: false,
      publicUrl: null,
      app: null,
    } satisfies SetupStatusResponse),
  )
  app.get('/auth/login', (c) => c.redirect(safeNextPath(c.req.query('next'))))
}
