// @vitest-environment jsdom
import { apiPaths, type RepoListResponse, type SetupStatusResponse } from '@repoerd/contracts'
import { act, cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RepoListPage } from '../../src/features/repo-picker/RepoListPage'
import { i18n } from '../../src/shared/i18n/i18n'
import { renderWithApp } from '../render'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const REPOS: RepoListResponse = {
  repos: [
    { owner: 'acme', name: 'shop', defaultBranch: 'main', private: true },
    { owner: 'acme', name: 'blog', defaultBranch: 'trunk', private: false },
  ],
}

function renderPage() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      path === apiPaths.repos
        ? Response.json(REPOS)
        : Response.json({
            user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
            mode: 'real',
          }),
    ),
  )
  renderWithApp(<RepoListPage />)
}

describe('RepoListPage', () => {
  it('links each repository to its diagram, with its default branch and visibility', async () => {
    renderPage()
    const shop = await screen.findByRole('link', { name: /acme\/shop/ })
    expect(shop.getAttribute('href')).toBe('/acme/shop')
    expect(within(shop).getByText('Private')).toBeTruthy()
    expect(within(shop).getByText('main')).toBeTruthy()
    expect(
      within(screen.getByRole('link', { name: /acme\/blog/ })).queryByText('Private'),
    ).toBeNull()
    expect(screen.getByText('2 repositories')).toBeTruthy()
  })

  it('filters the list and says when nothing matches', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('link', { name: /acme\/shop/ })
    await user.type(screen.getByRole('searchbox', { name: 'Filter repositories' }), 'zzz')
    expect(screen.getByText('No repository matches.')).toBeTruthy()
  })

  it('speaks French as soon as the language changes', async () => {
    renderPage()
    await screen.findByRole('link', { name: /acme\/shop/ })
    await act(() => i18n.changeLanguage('fr'))
    expect(screen.getByRole('heading', { name: 'Dépôts' })).toBeTruthy()
    expect(screen.getByText('Privé')).toBeTruthy()
    expect(screen.getByText('2 dépôts')).toBeTruthy()
  })

  it('offers the install link and a refresh when no repository is visible yet', async () => {
    const user = userEvent.setup()
    const requested: string[] = []
    const status: SetupStatusResponse = {
      mode: 'real',
      state: 'ready',
      unlocked: false,
      publicUrl: 'https://erd.example.com',
      app: {
        name: 'RepoERD',
        htmlUrl: 'https://github.com/apps/repoerd',
        installUrl: 'https://github.com/apps/repoerd/installations/new',
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        requested.push(path)
        if (path === apiPaths.repos) return Response.json({ repos: [] })
        if (path === apiPaths.reposRefresh) return Response.json(REPOS)
        if (path === apiPaths.setupStatus) return Response.json(status)
        return Response.json({
          user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
          mode: 'real',
        })
      }),
    )
    renderWithApp(<RepoListPage />)
    expect(
      (await screen.findByRole('link', { name: 'Install the GitHub App' })).getAttribute('href'),
    ).toBe('https://github.com/apps/repoerd/installations/new')
    await user.click(screen.getByRole('button', { name: 'Refresh the list' }))
    expect(await screen.findByRole('link', { name: /acme\/shop/ })).toBeTruthy()
    expect(requested).toContain('/api/repos?refresh=1')
  })

  it('says the refresh found nothing when the list is still empty', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === apiPaths.repos || path === apiPaths.reposRefresh)
          return Response.json({ repos: [] })
        if (path === apiPaths.setupStatus)
          return Response.json({
            mode: 'real',
            state: 'ready',
            unlocked: false,
            publicUrl: null,
            app: null,
          })
        return Response.json({
          user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
          mode: 'real',
        })
      }),
    )
    renderWithApp(<RepoListPage />)
    await user.click(await screen.findByRole('button', { name: 'Refresh the list' }))
    expect(await screen.findByText(/still no repository visible/)).toBeTruthy()
  })

  it('names the page and puts the focus on its title', async () => {
    renderPage()
    const heading = await screen.findByRole('heading', { name: 'Repositories' })
    expect(document.title).toBe('Repositories · RepoERD')
    expect(document.activeElement).toBe(heading)
  })
})
