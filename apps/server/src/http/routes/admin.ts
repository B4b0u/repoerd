import {
  type AdminConfigResponse,
  type AdminListResponse,
  type AdminUsersResponse,
  addAdminBodySchema,
  adminConfigBodySchema,
  apiPaths,
} from '@repoerd/contracts'
import type { AppUser } from '../../application/ports/user-repository.js'
import type { AdminError, AdminUserView } from '../../application/use-cases/admin.js'
import { clearCookie, SESSION_COOKIE } from '../cookies.js'
import { accessError, apiError } from '../errors.js'
import { readBody } from '../read-body.js'
import type { AppContext, AppDeps, AppHono } from '../types.js'
import { registerReplaceAppRoutes } from './replace-app.js'

function adminError(c: AppContext, error: AdminError) {
  switch (error.kind) {
    case 'invalid-organization':
      return apiError(
        c,
        400,
        'bad_request',
        `"${error.login}" is not a valid GitHub organisation name`,
        { reason: 'invalid-organization', login: error.login },
      )
    case 'invalid-public-url':
      return apiError(
        c,
        400,
        'bad_request',
        'The public URL must be an http(s) address without path, like https://erd.example.com',
        { reason: 'invalid-public-url' },
      )
    case 'self-lockout':
      return apiError(
        c,
        409,
        'conflict',
        'Your GitHub account has no access to an installation of the App on these organisations: saving would lock you out.',
        { reason: 'self-lockout' },
      )
    case 'reauth-required':
      return apiError(c, 401, 'reauth_required', 'Your GitHub sign-in has expired. Sign in again.')
    case 'user-not-found':
      return apiError(c, 404, 'not_found', 'This GitHub user has never signed in to RepoERD', {
        reason: 'user-never-signed-in',
      })
    case 'not-admin':
      return apiError(c, 404, 'not_found', 'This user is not an administrator', {
        reason: 'not-admin',
      })
    case 'config-changed':
      return apiError(
        c,
        409,
        'conflict',
        'The configuration changed since this page was loaded: reload it and save again',
        { reason: 'config-changed' },
      )
    case 'last-admin':
      return apiError(c, 409, 'conflict', 'RepoERD needs at least one administrator', {
        reason: 'last-admin',
      })
  }
}

const adminList = (admins: AppUser[]): AdminListResponse => ({
  admins: admins.map(({ id, login, avatarUrl }) => ({ id, login, avatarUrl })),
})

const userList = (users: AdminUserView[]): AdminUsersResponse => ({
  users: users.map((user) => ({
    id: user.id,
    login: user.login,
    stale: user.stale,
    avatarUrl: user.avatarUrl,
    isAdmin: user.isAdmin,
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    activeSessions: user.activeSessions,
  })),
})

/** /admin (spec §8): reserved to administrators, in both modes. Registered after the session middleware. */
export function registerAdminRoutes(app: AppHono, deps: AppDeps) {
  app.use('/api/admin/*', async (c, next) => {
    if (!c.get('user').isAdmin)
      return apiError(c, 403, 'forbidden', 'Administrators only', { reason: 'admins-only' })
    // An administrator who lost their GitHub access, or left the allowed organisations, loses
    // the administration too (checked like the repositories, cached 5 minutes).
    const access = await deps.repoAccess.checkUser(c.get('user').id)
    if (!access.ok) return accessError(c, access.error)
    await next()
  })

  app.get(apiPaths.adminConfig, async (c) =>
    c.json({ mode: deps.mode, ...(await deps.admin.getConfig()) } satisfies AdminConfigResponse),
  )

  app.put(apiPaths.adminConfig, async (c) => {
    const body = await readBody(c, adminConfigBodySchema)
    if (!body)
      return apiError(c, 400, 'bad_request', 'Invalid configuration body', {
        reason: 'invalid-body',
      })
    const result = await deps.admin.updateConfig(c.get('user').id, body)
    if (!result.ok) return adminError(c, result.error)
    return c.json({ mode: deps.mode, ...result.value } satisfies AdminConfigResponse)
  })

  app.get(apiPaths.adminAdmins, async (c) => c.json(adminList(await deps.admin.listAdmins())))

  app.post(apiPaths.adminAdmins, async (c) => {
    const body = await readBody(c, addAdminBodySchema)
    if (!body)
      return apiError(c, 400, 'bad_request', 'Invalid administrator body', {
        reason: 'invalid-body',
      })
    const result = await deps.admin.addAdmin(body.login)
    return result.ok ? c.json(adminList(result.value)) : adminError(c, result.error)
  })

  app.delete('/api/admin/admins/:id', async (c) => {
    const result = await deps.admin.removeAdmin(c.req.param('id'))
    return result.ok ? c.json(adminList(result.value)) : adminError(c, result.error)
  })

  app.get(apiPaths.adminUsers, async (c) => c.json(userList(await deps.admin.listUsers())))

  app.delete('/api/admin/users/:id/sessions', async (c) => {
    const id = c.req.param('id')
    const result = await deps.admin.signOutEverywhere(id)
    if (!result.ok) return adminError(c, result.error)
    // Signing yourself out everywhere ends this browser's session too.
    if (deps.mode === 'real' && id === c.get('user').id) clearCookie(c, SESSION_COOKIE)
    return c.json(userList(result.value))
  })

  // After the middleware above. The demo mode has no GitHub App to replace.
  if (deps.mode === 'real') registerReplaceAppRoutes(app, deps)
}
