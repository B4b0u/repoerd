// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/app/App'
import { i18n } from '../../src/shared/i18n/i18n'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const SOURCES: Record<string, string> = { shop: 'shop-core', blog: 'blog-core' }

describe('App routes', () => {
  it('shows the sources of the repository in the URL, never the previous ones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        const url = String(path)
        const repo = /\/repos\/acme\/(\w+)\/settings/.exec(url)?.[1]
        if (repo) {
          return Response.json({
            sources: [{ name: SOURCES[repo], format: 'prisma', paths: ['x'] }],
            canEdit: true,
          })
        }
        if (url === '/api/setup/status') return Response.json({ state: 'ready', mode: 'real' })
        return Response.json({
          user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
          mode: 'real',
        })
      }),
    )
    window.history.replaceState(null, '', '/acme/shop/settings')
    render(<App />)
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).value).toBe('shop-core')

    act(() => window.history.pushState(null, '', '/acme/blog/settings'))
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('blog-core'),
    )

    // Back to a repository whose settings are cached: no loading state resets the editor.
    act(() => window.history.pushState(null, '', '/acme/shop/settings'))
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('shop-core'),
    )
  })

  it('says in the language of the interface that a page does not exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        String(path) === '/api/setup/status'
          ? Response.json({ state: 'ready', mode: 'real' })
          : Response.json({
              user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
              mode: 'real',
            }),
      ),
    )
    window.history.replaceState(null, '', '/a/b/c/d')
    render(<App />)
    expect(await screen.findByText('Page not found.')).toBeTruthy()
    await act(() => i18n.changeLanguage('fr'))
    expect(screen.getByText('Page introuvable.')).toBeTruthy()
  })
})
