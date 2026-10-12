import { describe, expect, it } from 'vitest'
import { GitHubApi } from '../../src/infrastructure/github/github-api.js'
import { InstallationTokens } from '../../src/infrastructure/github/installation-tokens.js'
import { githubServer, installationHandlers, TEST_APP } from '../fakes/github-app.js'

const server = githubServer()
const repo = { owner: 'acme', name: 'shop' }

describe('InstallationTokens.forgetAll', () => {
  it('forgets every installation and token, and keeps nothing read while it ran', async () => {
    const counter = { tokens: 0 }
    server.use(...installationHandlers(['acme/shop'], counter))
    const installations = new InstallationTokens({
      api: new GitHubApi(),
      credentials: async () => TEST_APP,
    })
    expect(await installations.tokenFor(repo)).toBe('inst-1')
    expect(await installations.tokenFor(repo)).toBe('inst-1')
    installations.forgetAll()
    expect(await installations.tokenFor(repo)).toBe('inst-2')

    // A token still being created for the previous App is handed out but not remembered.
    installations.forgetAll()
    const running = installations.token(7)
    installations.forgetAll()
    const renewed = installations.token(7)
    // The new call does not share the old request, and only its token is remembered.
    expect(renewed).not.toBe(running)
    expect(await running).toBe('inst-3')
    expect(await renewed).toBe('inst-4')
    expect(await installations.token(7)).toBe('inst-4')
    expect(counter.tokens).toBe(4)
  })
})
