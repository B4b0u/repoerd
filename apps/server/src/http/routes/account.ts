import { apiPaths, type MeResponse } from '@repoerd/contracts'
import { clearCookie, SESSION_COOKIE } from '../cookies.js'
import type { AppDeps, AppHono } from '../types.js'

export function registerAccountRoutes(app: AppHono, deps: AppDeps) {
  app.get(apiPaths.me, (c) => c.json({ user: c.get('user'), mode: deps.mode } satisfies MeResponse))

  app.post(apiPaths.logout, async (c) => {
    if (deps.mode === 'real') {
      await deps.auth.signOut(c.get('sessionToken'))
      clearCookie(c, SESSION_COOKIE)
    }
    return c.body(null, 204)
  })
}
