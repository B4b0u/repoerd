// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const loaded = vi.hoisted(() => new Set<string>())

vi.mock('../../src/features/admin/AdminPage', async (importOriginal) => {
  loaded.add('admin')
  return importOriginal()
})
vi.mock('../../src/features/diagram/DiagramPage', async (importOriginal) => {
  loaded.add('diagram')
  return importOriginal()
})
vi.mock('../../src/features/repo-settings/RepoSettingsPage', async (importOriginal) => {
  loaded.add('settings')
  return importOriginal()
})
vi.mock('../../src/features/setup/SetupPage', async (importOriginal) => {
  loaded.add('setup')
  return importOriginal()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('pages loaded on demand', () => {
  it('are not part of the code loaded with the application', async () => {
    await import('../../src/app/App')
    expect([...loaded]).toEqual([])
  })

  it('are loaded when their route is opened', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        String(path) === '/api/setup/status'
          ? Response.json({ state: 'ready', mode: 'real' })
          : /\/settings$/.test(String(path))
            ? Response.json({
                sources: [{ name: 'shop-core', format: 'prisma', paths: ['x'] }],
                canEdit: true,
              })
            : Response.json({
                user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
                mode: 'real',
              }),
      ),
    )
    window.history.replaceState(null, '', '/acme/shop/settings')
    const { App } = await import('../../src/app/App')
    render(<App />)
    expect(await screen.findByLabelText('Name')).toBeTruthy()
    expect(loaded.has('settings')).toBe(true)
    expect(loaded.has('admin')).toBe(false)
  })
})
