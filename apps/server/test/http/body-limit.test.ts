import { MUTATION_HEADER } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { buildFakeModeApp } from './build-app.js'

const FOUR_MIB = 4 * 1024 * 1024
const tooBig = JSON.stringify({ positions: [], padding: 'x'.repeat(FOUR_MIB) })
const PATH = '/api/repos/acme/shop/layout?source=prisma%2Fschema.prisma&mode=ALL_FIELDS'

describe('request body limit', () => {
  it('refuses a body over 4 MiB with a 413 API error', async () => {
    const { app } = buildFakeModeApp()
    const response = await app.request(PATH, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', [MUTATION_HEADER]: '1' },
      body: tooBig,
    })
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ error: { code: 'payload_too_large' } })
  })

  it('also caps a body sent without Content-Length', async () => {
    const { app } = buildFakeModeApp()
    const bytes = new TextEncoder().encode(tooBig)
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 65536) controller.enqueue(bytes.slice(i, i + 65536))
        controller.close()
      },
    })
    const response = await app.request(PATH, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', [MUTATION_HEADER]: '1' },
      body: stream,
      duplex: 'half',
    })
    expect(response.status).toBe(413)
  })

  it('accepts a normal body', async () => {
    const { app } = buildFakeModeApp()
    const response = await app.request(PATH, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', [MUTATION_HEADER]: '1' },
      body: JSON.stringify({ positions: [{ table: 'users', x: 1, y: 2 }] }),
    })
    expect(response.status).toBe(204)
  })
})
