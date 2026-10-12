import { MUTATION_HEADER } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { buildRealModeApp } from './build-app.js'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const LAYOUT = '/api/repos/acme/shop/layout?source=prisma%2Fschema.prisma&mode=ALL_FIELDS'

/** Every mutating /api route of the real mode: its registered pattern and a path it answers. */
const ROUTES = [
  { method: 'POST', pattern: '/api/setup/unlock', path: '/api/setup/unlock' },
  { method: 'POST', pattern: '/api/setup/manifest', path: '/api/setup/manifest' },
  { method: 'POST', pattern: '/api/setup/existing-app', path: '/api/setup/existing-app' },
  { method: 'POST', pattern: '/api/auth/logout', path: '/api/auth/logout' },
  { method: 'PUT', pattern: '/api/admin/config', path: '/api/admin/config' },
  { method: 'POST', pattern: '/api/admin/admins', path: '/api/admin/admins' },
  { method: 'DELETE', pattern: '/api/admin/admins/:id', path: '/api/admin/admins/1' },
  {
    method: 'DELETE',
    pattern: '/api/admin/users/:id/sessions',
    path: '/api/admin/users/1/sessions',
  },
  { method: 'POST', pattern: '/api/admin/app/manifest', path: '/api/admin/app/manifest' },
  { method: 'POST', pattern: '/api/admin/app/existing', path: '/api/admin/app/existing' },
  { method: 'PATCH', pattern: '/api/repos/:owner/:repo/layout', path: LAYOUT },
  { method: 'PUT', pattern: '/api/repos/:owner/:repo/layout', path: LAYOUT },
  {
    method: 'PUT',
    pattern: '/api/repos/:owner/:repo/settings',
    path: '/api/repos/acme/shop/settings',
  },
]

/** A configured instance and the cookie of a signed-in administrator. */
async function signedInAdmin() {
  const world = buildRealModeApp()
  const cookie = await world.signIn('admin', 'admin')
  return { app: world.app, cookie }
}

type ErrorBody = { error?: { code?: string; details?: { reason?: string } } } | null

describe('CSRF in real mode', () => {
  it('covers every mutating API route of the real mode', async () => {
    const { app } = await signedInAdmin()
    const registered = app.routes
      .filter((route) => MUTATING.has(route.method) && route.path.startsWith('/api/'))
      .map((route) => `${route.method} ${route.path}`)
    expect([...new Set(registered)].sort()).toEqual(
      ROUTES.map((route) => `${route.method} ${route.pattern}`).sort(),
    )
  })

  it.each(ROUTES)(
    'refuses $method $pattern without the custom header, even for a signed-in administrator',
    async ({ method, path }) => {
      const { app, cookie } = await signedInAdmin()
      const response = await app.request(path, {
        method,
        headers: { cookie, 'content-type': 'application/json' },
        body: '{}',
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        error: { code: 'forbidden', details: { reason: 'missing-mutation-header' } },
      })
    },
  )

  it.each(ROUTES)(
    'lets $method $pattern reach its handler with the header',
    async ({ method, path }) => {
      const { app, cookie } = await signedInAdmin()
      const response = await app.request(path, {
        method,
        headers: { cookie, 'content-type': 'application/json', [MUTATION_HEADER]: '1' },
        body: '{}',
      })
      const body = (await response.json().catch(() => null)) as ErrorBody
      expect(body?.error?.details?.reason).not.toBe('missing-mutation-header')
    },
  )
})
