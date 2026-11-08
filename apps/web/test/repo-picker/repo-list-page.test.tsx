// @vitest-environment jsdom
import {
  apiPaths,
  type RepoDto,
  type RepoListResponse,
  type SetupStatusResponse,
} from '@repoerd/contracts'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RepoListPage } from '../../src/features/repo-picker/RepoListPage'
import { i18n } from '../../src/shared/i18n/i18n'
import { renderWithApp } from '../render'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const HOUR = 3600_000
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString()

function repo(owner: string, name: string, extra: Partial<RepoDto> = {}): RepoDto {
  return {
    owner,
    name,
    defaultBranch: 'main',
    private: false,
    favorite: false,
    lastOpenedAt: null,
    ownerAvatarUrl: null,
    format: { kind: 'prisma', checkedAt: hoursAgo(3) },
    formatPending: false,
    ...extra,
  }
}

const REPOS: RepoDto[] = [
  repo('acme', 'storefront', { favorite: true, private: true }),
  repo('acme', 'blog', {
    defaultBranch: 'trunk',
    lastOpenedAt: hoursAgo(2),
    format: { kind: 'drizzle', checkedAt: hoursAgo(1) },
  }),
  repo('acme', 'no-schema', { format: { kind: 'none', checkedAt: hoursAgo(1) } }),
  repo('acme', 'fresh', { format: null, formatPending: true }),
  repo('globex', 'billing', { format: { kind: 'both', checkedAt: hoursAgo(5) } }),
]

const ME = {
  user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
  mode: 'real',
}

/** Renders the page against a server keeping the stars it is sent. */
function renderPage(initial: RepoDto[] = REPOS) {
  let repos = initial
  const requests: { method: string; path: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, path })
      if (path === apiPaths.repos) return Response.json({ repos } satisfies RepoListResponse)
      if (path.endsWith('/favorite')) {
        repos = repos.map((r) =>
          path === apiPaths.favorite(r) ? { ...r, favorite: method === 'PUT' } : r,
        )
        return new Response(null, { status: 204 })
      }
      if (path === apiPaths.repoFormats) return Response.json({ formats: [] })
      return Response.json(ME)
    }),
  )
  renderWithApp(<RepoListPage />)
  return requests
}

const section = (name: string) => screen.getByRole('region', { name })

describe('RepoListPage', () => {
  it('shows the favourites as cards, and a hint instead when there is none', async () => {
    renderPage()
    const favorites = await screen.findByRole('region', { name: 'Favourites' })
    expect(within(favorites).getByRole('link', { name: 'acme/storefront' })).toBeTruthy()
    expect(within(favorites).queryByRole('link', { name: 'acme/blog' })).toBeNull()
    expect(screen.queryByText('Star repositories to find them here.')).toBeNull()
    cleanup()

    renderPage(REPOS.map((r) => ({ ...r, favorite: false })))
    expect(await screen.findByText('Star repositories to find them here.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Favourites' })).toBeNull()
  })

  it('shows the recently opened repositories with when they were opened', async () => {
    renderPage()
    const recents = await screen.findByRole('region', { name: 'Recent' })
    const blog = within(recents).getByRole('link', { name: 'acme/blog' })
    expect(within(blog).getByText('Opened 2 hours ago')).toBeTruthy()
  })

  it('groups the list by owner only when there are several owners', async () => {
    renderPage()
    const all = await screen.findByRole('region', { name: 'All repositories' })
    expect(within(all).getByRole('heading', { level: 3, name: 'acme' })).toBeTruthy()
    expect(within(all).getByRole('heading', { level: 3, name: 'globex' })).toBeTruthy()
    cleanup()

    renderPage(REPOS.filter((r) => r.owner === 'acme'))
    const single = await screen.findByRole('region', { name: 'All repositories' })
    expect(within(single).queryAllByRole('heading', { level: 3 })).toEqual([])
    expect(within(single).getByRole('link', { name: 'acme/blog' })).toBeTruthy()
  })

  it('hides the repositories without a schema until asked to show them all', async () => {
    const user = userEvent.setup()
    renderPage()
    const all = await screen.findByRole('region', { name: 'All repositories' })
    expect(within(all).queryByRole('link', { name: 'acme/no-schema' })).toBeNull()
    expect(screen.getByText('1 repository without a schema hidden')).toBeTruthy()
    expect(screen.getByText('4 of 5')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'With a schema' }).getAttribute('aria-selected')).toBe(
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Show all repositories' }))
    const noSchema = within(section('All repositories')).getByRole('link', {
      name: 'acme/no-schema',
    })
    expect(within(noSchema).getByText('No schema')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('5 repositories')).toBeTruthy()
  })

  it('moves the focus to the "All" tab when "Show all repositories" disappears', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Show all repositories' }))
    expect(screen.queryByRole('button', { name: 'Show all repositories' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'All' }))
  })

  it('moves the focus to the row star when a favourite card leaves with its star', async () => {
    const user = userEvent.setup()
    renderPage()
    const favorites = await screen.findByRole('region', { name: 'Favourites' })
    await user.click(
      within(favorites).getByRole('button', { name: 'Remove acme/storefront from favourites' }),
    )
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Favourites' })).toBeNull())
    expect(document.activeElement).toBe(
      within(section('All repositories')).getByRole('button', {
        name: 'Add acme/storefront to favourites',
      }),
    )
  })

  it('shows the format of each repository and when it was checked', async () => {
    renderPage()
    const all = await screen.findByRole('region', { name: 'All repositories' })
    const billing = within(all).getByRole('link', { name: 'globex/billing' })
    expect(within(billing).getByText('Prisma')).toBeTruthy()
    expect(within(billing).getByText('Drizzle')).toBeTruthy()
    expect(within(billing).getByText('Checked 5 hours ago')).toBeTruthy()
    expect(within(billing).getByTitle('Checked 5 hours ago')).toBeTruthy()
    const fresh = within(all).getByRole('link', { name: 'acme/fresh' })
    expect(within(fresh).getByLabelText('Detecting the schema…')).toBeTruthy()
  })

  it('focuses the search with the / key, unless the focus is in a field', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('region', { name: 'All repositories' })
    const search = screen.getByRole('searchbox', { name: 'Filter repositories' })
    await user.keyboard('/')
    expect(document.activeElement).toBe(search)
    expect((search as HTMLInputElement).value).toBe('')
    await user.keyboard('/')
    expect((search as HTMLInputElement).value).toBe('/')
  })

  it('leaves the / key to the browser when no search box is shown', async () => {
    renderPage([])
    await screen.findByRole('button', { name: 'Refresh the list' })
    expect(screen.queryByRole('searchbox')).toBeNull()
    const slash = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    document.body.dispatchEvent(slash)
    // Firefox's Quick Find stays reachable.
    expect(slash.defaultPrevented).toBe(false)
  })

  it('hides favourites and recents while searching, and offers to clear a search without match', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('region', { name: 'Favourites' })
    const search = screen.getByRole('searchbox', { name: 'Filter repositories' })
    await user.type(search, 'bil')
    expect(screen.queryByRole('region', { name: 'Favourites' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Recent' })).toBeNull()
    expect(screen.getByRole('link', { name: 'globex/billing' })).toBeTruthy()

    await user.clear(search)
    await user.type(search, 'zzz')
    expect(screen.getByText('No repository matches “zzz”.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Clear the search' }))
    expect((search as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('region', { name: 'Favourites' })).toBeTruthy()
  })

  it('says when the filter hides the only matches of a search', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('region', { name: 'All repositories' })
    await user.type(screen.getByRole('searchbox', { name: 'Filter repositories' }), 'no-sch')
    expect(screen.getByText('1 repository without a schema hidden')).toBeTruthy()
    expect(screen.queryByText(/No repository matches/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show all repositories' }))
    expect(screen.getByRole('link', { name: 'acme/no-schema' })).toBeTruthy()
  })

  it('says when no repository has a schema yet', async () => {
    renderPage([repo('acme', 'no-schema', { format: { kind: 'none', checkedAt: hoursAgo(1) } })])
    expect(await screen.findByText('No repository with a schema yet.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show all repositories' })).toBeTruthy()
  })

  it('stars a repository with a separate button that names it', async () => {
    const user = userEvent.setup()
    const requests = renderPage()
    const all = await screen.findByRole('region', { name: 'All repositories' })
    const unstar = within(all).getByRole('button', {
      name: 'Remove acme/storefront from favourites',
    })
    expect(unstar.getAttribute('aria-pressed')).toBe('true')
    expect(unstar.closest('a')).toBeNull()
    const star = within(all).getByRole('button', { name: 'Add acme/blog to favourites' })
    expect(star.getAttribute('aria-pressed')).toBe('false')

    await user.click(star)
    await waitFor(() =>
      expect(
        within(section('All repositories'))
          .getByRole('button', { name: 'Remove acme/blog from favourites' })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    )
    expect(requests).toContainEqual({
      method: 'PUT',
      path: apiPaths.favorite({ owner: 'acme', name: 'blog' }),
    })
  })

  it('links each repository to its diagram, with its default branch and visibility', async () => {
    renderPage()
    const all = await screen.findByRole('region', { name: 'All repositories' })
    const links = screen.getAllByRole('link', { name: 'acme/storefront' })
    expect(links.length).toBe(2) // the favourite card and the row
    for (const link of links) expect(link.getAttribute('href')).toBe('/acme/storefront')
    const storefront = within(all).getByRole('link', { name: 'acme/storefront' })
    expect(within(storefront).getByText('Private')).toBeTruthy()
    expect(within(storefront).getByText('main')).toBeTruthy()
    const blog = within(all).getByRole('link', { name: 'acme/blog' })
    expect(within(blog).queryByText('Private')).toBeNull()
    expect(within(blog).getByText('trunk')).toBeTruthy()
  })

  it('speaks French as soon as the language changes', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Favourites' })
    await act(() => i18n.changeLanguage('fr'))
    expect(screen.getByRole('heading', { level: 2, name: 'Favoris' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Avec un schéma' })).toBeTruthy()
    expect(screen.getByText('1 dépôt sans schéma masqué')).toBeTruthy()
  })

  it('shows placeholders while the list loads, announced to screen readers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path === apiPaths.repos ? new Promise<Response>(() => {}) : Response.json(ME),
      ),
    )
    renderWithApp(<RepoListPage />)
    expect(await screen.findByText('Loading repositories…')).toBeTruthy()
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
        if (path === apiPaths.reposRefresh) return Response.json({ repos: REPOS })
        if (path === apiPaths.setupStatus) return Response.json(status)
        return Response.json(ME)
      }),
    )
    renderWithApp(<RepoListPage />)
    expect(
      (await screen.findByRole('link', { name: 'Install the GitHub App' })).getAttribute('href'),
    ).toBe('https://github.com/apps/repoerd/installations/new')
    await user.click(screen.getByRole('button', { name: 'Refresh the list' }))
    const all = await screen.findByRole('region', { name: 'All repositories' })
    expect(within(all).getByRole('link', { name: 'acme/storefront' })).toBeTruthy()
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
        return Response.json(ME)
      }),
    )
    renderWithApp(<RepoListPage />)
    await user.click(await screen.findByRole('button', { name: 'Refresh the list' }))
    expect(await screen.findByText(/still no repository visible/)).toBeTruthy()
  })

  it('names the page and puts the focus on its title', async () => {
    renderPage()
    const heading = await screen.findByRole('heading', { level: 1, name: 'Repositories' })
    expect(document.title).toBe('Repositories · RepoERD')
    expect(document.activeElement).toBe(heading)
  })
})
