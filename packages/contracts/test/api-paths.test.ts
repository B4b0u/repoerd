import { describe, expect, it } from 'vitest'
import { APP_REPLACED_PATH, apiPaths, savePositionsBodySchema } from '../src/index.js'

const repo = { owner: 'acme', name: 'shop' }

describe('apiPaths', () => {
  it('encodes branch names containing slashes, #, + and accents', () => {
    expect(apiPaths.schema(repo, { branch: 'feature/odd#1+é' })).toBe(
      '/api/repos/acme/shop/schema?branch=feature%2Fodd%231%2B%C3%A9',
    )
  })

  it('omits empty parameters', () => {
    expect(apiPaths.schema(repo)).toBe('/api/repos/acme/shop/schema')
    expect(apiPaths.schema(repo, { branch: undefined, source: '' })).toBe(
      '/api/repos/acme/shop/schema',
    )
  })

  it('builds comparison paths, leaving out what is not given', () => {
    const shop = { owner: 'acme', name: 'shop' }
    expect(apiPaths.compare(shop, { base: 'feature/odd#1+é' })).toBe(
      '/api/repos/acme/shop/compare?base=feature%2Fodd%231%2B%C3%A9',
    )
    expect(apiPaths.compare(shop, { base: 'main', head: 'b', mode: 'direct', source: 's' })).toBe(
      '/api/repos/acme/shop/compare?base=main&head=b&mode=direct&source=s',
    )
  })

  it('builds branch and layout paths', () => {
    expect(apiPaths.branches(repo)).toBe('/api/repos/acme/shop/branches')
    expect(apiPaths.layout(repo, 'prisma/schema.prisma', 'KEYS_ONLY')).toBe(
      '/api/repos/acme/shop/layout?source=prisma%2Fschema.prisma&mode=KEYS_ONLY',
    )
    expect(apiPaths.layout(repo, 'db/schema.prisma', 'ALL_FIELDS', { inherit: true })).toBe(
      '/api/repos/acme/shop/layout?source=db%2Fschema.prisma&mode=ALL_FIELDS&inherit=1',
    )
    expect(apiPaths.layout(repo, 'db/schema.prisma', 'ALL_FIELDS', { inherit: false })).toBe(
      '/api/repos/acme/shop/layout?source=db%2Fschema.prisma&mode=ALL_FIELDS',
    )
  })

  it('builds the setup, sign-in and sign-out paths', () => {
    expect(apiPaths.setupStatus).toBe('/api/setup/status')
    expect(apiPaths.setupUnlock).toBe('/api/setup/unlock')
    expect(apiPaths.setupManifest).toBe('/api/setup/manifest')
    expect(apiPaths.setupExistingApp).toBe('/api/setup/existing-app')
    expect(apiPaths.logout).toBe('/api/auth/logout')
    expect(apiPaths.signIn('/acme/shop?branch=feature%2Fx')).toBe(
      '/auth/login?next=%2Facme%2Fshop%3Fbranch%3Dfeature%252Fx',
    )
    expect(apiPaths.signIn('/')).toBe('/auth/login?next=%2F')
  })

  it('builds the settings and administration paths', () => {
    expect(apiPaths.repoSettings({ owner: 'acme', name: 'my repo' })).toBe(
      '/api/repos/acme/my%20repo/settings',
    )
    expect(apiPaths.adminConfig).toBe('/api/admin/config')
    expect(apiPaths.adminAdmins).toBe('/api/admin/admins')
    expect(apiPaths.adminAdmin('12/3')).toBe('/api/admin/admins/12%2F3')
    expect(apiPaths.adminAppManifest).toBe('/api/admin/app/manifest')
    expect(apiPaths.adminExistingApp).toBe('/api/admin/app/existing')
    expect(apiPaths.adminUsers).toBe('/api/admin/users')
    expect(apiPaths.adminUserSessions('12/3')).toBe('/api/admin/users/12%2F3/sessions')
    expect(APP_REPLACED_PATH).toBe('/signin?notice=app-replaced')
  })
})

describe('savePositionsBodySchema', () => {
  it('accepts positions and rejects malformed bodies', () => {
    expect(
      savePositionsBodySchema.safeParse({ positions: [{ table: 'a', x: 1, y: 2 }] }).success,
    ).toBe(true)
    expect(
      savePositionsBodySchema.safeParse({ positions: [{ table: 'a', x: '1', y: 2 }] }).success,
    ).toBe(false)
    expect(savePositionsBodySchema.safeParse({}).success).toBe(false)
  })
})
