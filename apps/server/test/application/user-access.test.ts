import { describe, expect, it } from 'vitest'
import { revokeUserAccess } from '../../src/application/services/user-access.js'
import { InMemorySessionRepository, InMemoryUserRepository } from '../fakes/in-memory-stores.js'

describe('revokeUserAccess', () => {
  it('erases every GitHub token and ends every session, keeping the users and their rights', async () => {
    const users = new InMemoryUserRepository()
    const sessions = new InMemorySessionRepository()
    await users.upsert({ id: '1', login: 'alice', avatarUrl: null })
    await users.setAdmin('1', true)
    await users.saveTokens('1', {
      accessToken: 'ghu_1',
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    })
    await sessions.create({
      idHash: 'a',
      userId: '1',
      expiresAt: new Date(10_000),
      lastSeenAt: new Date(0),
      createdAt: new Date(0),
    })

    expect(await revokeUserAccess({ users, sessions })).toEqual({
      tokensCleared: 1,
      sessionsDeleted: 1,
    })
    expect(await users.getTokens('1')).toBeNull()
    expect(sessions.sessions.size).toBe(0)
    expect(await users.get('1')).toMatchObject({ isAdmin: true })
  })
})
