import { apiPaths } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '../../src/domain/rate-limit.js'
import { buildFakeModeApp, buildRealModeApp, jsonRequest, ODD_BRANCH } from './build-app.js'

const repo = { owner: 'acme', name: 'shop' }

describe('request rate limits', () => {
  it('answer 429 with retry-after past 60 requests a minute, per user', async () => {
    let clock = 0
    const { app, signIn } = buildRealModeApp({
      userRateLimit: createRateLimiter({ limit: 60, windowMs: 60_000, now: () => clock }),
    })
    const alice = await signIn('1', 'alice')
    const bob = await signIn('2', 'bob')
    const schema = (cookie: string) => app.request(apiPaths.schema(repo), { headers: { cookie } })
    for (let request = 1; request <= 30; request++) {
      expect((await schema(alice)).status).toBe(200)
      const compare = await app.request(apiPaths.compare(repo, { base: ODD_BRANCH }), {
        headers: { cookie: alice },
      })
      expect(compare.status).toBe(200)
    }

    const limited = await app.request(
      apiPaths.layout(repo, 'prisma/schema.prisma', 'ALL_FIELDS'),
      jsonRequest('PATCH', { positions: [] }, alice),
    )
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('1')
    expect(await limited.json()).toEqual({
      error: { code: 'rate_limited', message: 'Too many requests. Try again in a moment.' },
    })
    // Another user, and the routes that cost no parse, are not limited.
    expect((await schema(bob)).status).toBe(200)
    expect(
      (await app.request(apiPaths.branches(repo), { headers: { cookie: alice } })).status,
    ).toBe(200)
    clock = 1_000
    expect((await schema(alice)).status).toBe(200)
  })

  it('do not apply in fake mode, whose single demo user is everyone', async () => {
    const { app } = buildFakeModeApp()
    for (let request = 1; request <= 70; request++) {
      expect((await app.request(apiPaths.schema(repo))).status).toBe(200)
    }
  })
})
