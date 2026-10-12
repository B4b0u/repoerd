import { MUTATION_HEADER } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { buildFakeModeApp, buildRealModeApp } from './build-app.js'

const send = (method: string, body: string, cookie?: string) => ({
  method,
  headers: {
    'content-type': 'application/json',
    [MUTATION_HEADER]: '1',
    ...(cookie ? { cookie } : {}),
  },
  body,
})

describe('bad requests carry a reason', () => {
  it.each([
    [
      'invalid JSON positions',
      'PATCH',
      '/api/repos/acme/shop/layout?source=s&mode=ALL_FIELDS',
      '{nope',
      'invalid-body',
    ],
    [
      'positions of the wrong shape',
      'PATCH',
      '/api/repos/acme/shop/layout?source=s&mode=ALL_FIELDS',
      '{"positions":"x"}',
      'invalid-body',
    ],
    [
      'a layout without source',
      'PATCH',
      '/api/repos/acme/shop/layout?mode=ALL_FIELDS',
      '{"positions":[]}',
      'invalid-layout-target',
    ],
    [
      'an unknown display mode',
      'PATCH',
      '/api/repos/acme/shop/layout?source=s&mode=BOGUS',
      '{"positions":[]}',
      'invalid-layout-target',
    ],
    [
      'a source id the domain refuses',
      'PUT',
      `/api/repos/acme/shop/layout?source=${'s'.repeat(513)}&mode=ALL_FIELDS`,
      '{"positions":[]}',
      'invalid-layout-target',
    ],
    ['invalid settings', 'PUT', '/api/repos/acme/shop/settings', '{"sources":"x"}', 'invalid-body'],
  ])('%s', async (_label, method, path, body, reason) => {
    const { app } = buildFakeModeApp()
    const response = await app.request(path, send(method, body))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'bad_request', details: { reason } },
    })
  })

  it('a layout read without target', async () => {
    const { app } = buildFakeModeApp()
    const response = await app.request('/api/repos/acme/shop/layout')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { details: { reason: 'invalid-layout-target' } },
    })
  })

  it('an invalid repository name', async () => {
    const { app } = buildFakeModeApp()
    const response = await app.request('/api/repos/acme/bad%20name/schema')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'bad_request', details: { reason: 'invalid-repository-name' } },
    })
  })

  it('invalid administration bodies', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn('admin', 'admin')
    for (const [method, path] of [
      ['PUT', '/api/admin/config'],
      ['POST', '/api/admin/admins'],
    ] as const) {
      const response = await world.app.request(path, send(method, '{"x":1}', cookie))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: { code: 'bad_request', details: { reason: 'invalid-body' } },
      })
    }
  })

  it('an invalid setup body', async () => {
    const world = buildRealModeApp({ ready: false })
    await world.setup.issueCode()
    const response = await world.app.request('/api/setup/unlock', send('POST', '{}'))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'bad_request', details: { reason: 'invalid-body' } },
    })
  })
})
