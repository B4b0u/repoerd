// @vitest-environment jsdom
import { apiPaths, type SetupStatusResponse } from '@repoerd/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppGate } from '../../src/app/AppGate'
import { i18n } from '../../src/shared/i18n/i18n'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const ready: SetupStatusResponse = {
  mode: 'real',
  state: 'ready',
  unlocked: false,
  publicUrl: 'https://erd.example.com',
  app: null,
}

function renderGate(path: string, me: Response) {
  window.history.replaceState(null, '', path)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url === apiPaths.me ? me : Response.json(ready))),
  )
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AppGate>
        <p>The app</p>
      </AppGate>
    </QueryClientProvider>,
  )
}

const unauthenticated = () =>
  Response.json({ error: { code: 'unauthenticated', message: 'Sign in' } }, { status: 401 })

describe('AppGate', () => {
  it('shows the sign-in page, without redirecting, when /api/me answers 401 unauthenticated', async () => {
    const assign = vi.fn()
    const real = window.location
    vi.stubGlobal('location', {
      get pathname() {
        return real.pathname
      },
      get search() {
        return real.search
      },
      assign,
    })
    renderGate('/', unauthenticated())
    expect(await screen.findByRole('link', { name: 'Sign in with GitHub' })).toBeTruthy()
    expect(screen.queryByText('The app')).toBeNull()
    expect(assign).not.toHaveBeenCalled()
  })

  it('shows the sign-in page on /signin, which is not a route of its own', async () => {
    renderGate('/signin?error=denied', Response.json({}))
    const link = await screen.findByRole('link', { name: 'Sign in with GitHub' })
    expect(link.getAttribute('href')).toBe(apiPaths.signIn('/'))
    expect((await screen.findByRole('alert')).textContent).toContain('cancelled')
    expect(screen.queryByText('The app')).toBeNull()
  })

  it('says in French that the server cannot be reached', async () => {
    await i18n.changeLanguage('fr')
    window.history.replaceState(null, '', '/')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AppGate>
          <p>The app</p>
        </AppGate>
      </QueryClientProvider>,
    )
    expect((await screen.findByText(/^Impossible de joindre le serveur : /)).textContent).toContain(
      'Vérifiez votre connexion',
    )
    expect(screen.queryByText('The app')).toBeNull()
  })

  it('says in French that the account cannot be loaded', async () => {
    await i18n.changeLanguage('fr')
    renderGate(
      '/',
      Response.json({ error: { code: 'internal_error', message: 'Boom' } }, { status: 500 }),
    )
    expect(
      (await screen.findByText(/^Impossible de charger votre compte : /)).textContent,
    ).toContain('Erreur inattendue du serveur.')
  })

  it('shows the app once /api/me answers', async () => {
    renderGate('/', Response.json({ user: { login: 'octocat' }, mode: 'real' }))
    expect(await screen.findByText('The app')).toBeTruthy()
  })
})
