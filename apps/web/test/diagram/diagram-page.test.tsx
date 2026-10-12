// @vitest-environment jsdom
import type { SchemaResponse } from '@repoerd/contracts'
import type { SchemaFailure } from '@repoerd/model'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramPage } from '../../src/features/diagram/DiagramPage'
import { i18n } from '../../src/shared/i18n/i18n'
import { renderWithApp } from '../render'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPage(
  path: string,
  failure: SchemaFailure,
  branches = ['feature/x'],
  overrides: Partial<SchemaResponse> = {},
  branchesStatus = 200,
) {
  window.history.replaceState(null, '', path)
  const schema: SchemaResponse = {
    repo: { owner: 'acme', name: 'shop' },
    branch: 'feature/x',
    commitSha: 'abcdef1234567',
    commitUrl: null,
    sources: [],
    selectedSourceId: null,
    schema: null,
    failure,
    treeTruncated: false,
    ...overrides,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const requested = String(url)
      if (requested.includes('/schema')) return Response.json(schema)
      if (requested.endsWith('/branches'))
        return branchesStatus === 200
          ? Response.json({
              defaultBranch: 'main',
              branches: branches.map((name) => ({ name })),
              truncated: false,
            })
          : Response.json(
              { error: { code: 'internal_error', message: 'Boom' } },
              { status: branchesStatus },
            )
      return Response.json({
        user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
        mode: 'real',
      })
    }),
  )
  renderWithApp(
    <DiagramPage owner="acme" repo="shop" />,
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
}

async function openBranches(user: ReturnType<typeof userEvent.setup>) {
  const picker = (await screen.findByRole('combobox', { name: /^Branch/ })) as HTMLButtonElement
  await vi.waitFor(() => expect(picker.disabled).toBe(false))
  picker.focus()
  await user.keyboard('{Enter}')
}

describe('DiagramPage', () => {
  it('opens the schema sources with the current branch and view', async () => {
    renderPage('/acme/shop?branch=feature%2Fx&mode=TABLE_NAME', { kind: 'source-empty' })
    const expected = '/acme/shop/settings?branch=feature%2Fx&mode=TABLE_NAME'
    expect(screen.getByRole('link', { name: /Sources/ }).getAttribute('href')).toBe(expected)
    expect(
      (
        await screen.findByRole('link', { name: 'Declare the schema sources by hand' })
      ).getAttribute('href'),
    ).toBe(expected)
  })

  it('offers the default schema when the source in the URL no longer exists', async () => {
    renderPage('/acme/shop?branch=feature%2Fx&source=manual%3Aold&mode=TABLE_NAME&active=users', {
      kind: 'source-not-found',
      sourceId: 'manual:old',
    })
    expect(
      (await screen.findByRole('link', { name: 'Show the default schema' })).getAttribute('href'),
    ).toBe('/acme/shop?branch=feature%2Fx&mode=TABLE_NAME')
  })

  it('picks a branch from the searchable list with the keyboard only', async () => {
    const user = userEvent.setup()
    renderPage('/acme/shop?branch=feature%2Fx', { kind: 'source-empty' }, [
      'main',
      'feature/x',
      'release/2.0',
    ])
    await openBranches(user)
    await user.keyboard('rel')
    expect(screen.queryByRole('option', { name: 'main' })).toBeNull()
    await user.keyboard('{Enter}')
    await vi.waitFor(() =>
      expect(new URLSearchParams(window.location.search).get('branch')).toBe('release/2.0'),
    )
  })

  it('says when no branch matches the search', async () => {
    const user = userEvent.setup()
    renderPage('/acme/shop', { kind: 'source-empty' }, ['main', 'feature/x'])
    await openBranches(user)
    await user.keyboard('zzz')
    expect(await screen.findByText('No branch found.')).toBeTruthy()
  })

  it('warns when GitHub truncated the repository tree', async () => {
    renderPage('/repos/acme/shop', { kind: 'no-schema-found' }, ['main'], { treeTruncated: true })
    const warning = await screen.findByText(/too large for the GitHub API/)
    const failure = await screen.findByText(/No Prisma or Drizzle schema/)
    // The warning is advisory and sits outside the diagram section, so it hides nothing.
    const status = warning.closest('[role="status"]')
    expect(status).not.toBeNull()
    const section = failure.closest('section') as HTMLElement
    expect(section.contains(status)).toBe(false)
    expect(section.contains(failure)).toBe(true)
  })

  it('tells in the status bar how many views are not drawn', async () => {
    renderPage('/acme/shop', { kind: 'source-empty' }, ['main'], {
      failure: null,
      selectedSourceId: 'prisma/schema.prisma',
      schema: { tables: {}, enums: {}, relationships: [], ignoredViews: 2 },
    })
    const notice = await screen.findByText('2 views are not shown: RepoERD draws tables only.')
    expect(notice.closest('[role="status"]')).not.toBeNull()
    expect(await screen.findByText('This schema has no tables.')).toBeTruthy()
  })

  it('shows no warning when the tree is complete', async () => {
    renderPage('/repos/acme/shop', { kind: 'no-schema-found' }, ['main'])
    await screen.findByText(/No Prisma or Drizzle schema/)
    expect(screen.queryByText(/too large for the GitHub API/)).toBeNull()
  })

  it('translates the failure message when the language changes', async () => {
    renderPage('/acme/shop', { kind: 'no-schema-found' })
    expect(await screen.findByText(/No Prisma or Drizzle schema/)).toBeTruthy()
    await act(() => i18n.changeLanguage('fr'))
    expect(await screen.findByText(/Aucun schéma Prisma ou Drizzle/)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Déclarer les sources du schéma à la main' }),
    ).toBeTruthy()
  })

  it('refreshes the branches and the schema, and shows when it is done', async () => {
    const user = userEvent.setup()
    renderPage('/acme/shop?branch=feature%2Fx', { kind: 'no-schema-found' })
    const refresh = await screen.findByRole('button', { name: 'Refresh from the repository' })
    await vi.waitFor(() => expect(refresh.getAttribute('aria-busy')).toBe('false'))
    const fetchMock = vi.mocked(fetch)
    const before = fetchMock.mock.calls.length
    await user.click(refresh)
    await vi.waitFor(() => expect(refresh.getAttribute('aria-busy')).toBe('false'))
    const urls = fetchMock.mock.calls.slice(before).map(([url]) => String(url))
    expect(urls.some((url) => url.includes('/schema'))).toBe(true)
    expect(urls.some((url) => url.endsWith('/branches'))).toBe(true)
  })

  it('keeps the names of the secondary buttons when their text is hidden on narrow screens', async () => {
    renderPage('/acme/shop?branch=feature%2Fx', { kind: 'no-schema-found' })
    for (const control of [
      screen.getByRole('link', { name: 'Sources' }),
      screen.getByRole('button', { name: 'Copy link' }),
      screen.getByRole('button', { name: 'Compare' }),
    ]) {
      expect(control.querySelector('.sr-only.xl\\:not-sr-only')).toBeTruthy()
    }
  })

  describe('resetting the view', () => {
    const crowded =
      '/acme/shop?branch=main&source=manual%3Aa&mode=TABLE_NAME&active=users&focus=orders&hidden=logs&shown=users&shown=orders'
    const sources = [
      { id: 'manual:a', name: 'Source A', format: 'prisma' as const, problem: null },
      { id: 'manual:b', name: 'Source B', format: 'drizzle' as const, problem: null },
    ]
    const search = () => new URLSearchParams(window.location.search)

    it('keeps the source but forgets the table selection when another branch is picked', async () => {
      const user = userEvent.setup()
      renderPage(crowded, { kind: 'source-empty' }, ['main', 'release/2.0'], {
        sources,
        selectedSourceId: 'manual:a',
      })
      await openBranches(user)
      await user.keyboard('rel{Enter}')
      await vi.waitFor(() => expect(search().get('branch')).toBe('release/2.0'))
      for (const key of ['active', 'focus', 'hidden', 'shown']) {
        expect(search().has(key)).toBe(false)
      }
      expect(search().get('source')).toBe('manual:a')
      expect(search().get('mode')).toBe('TABLE_NAME')
    })

    it('forgets the table selection, but keeps the branch, when another source is picked', async () => {
      const user = userEvent.setup()
      renderPage(crowded, { kind: 'source-empty' }, ['main'], {
        sources,
        selectedSourceId: 'manual:a',
      })
      await user.click(await screen.findByRole('combobox', { name: 'Schema' }))
      await user.click(await screen.findByRole('option', { name: /Source B/ }))
      await vi.waitFor(() => expect(search().get('source')).toBe('manual:b'))
      for (const key of ['active', 'focus', 'hidden', 'shown']) {
        expect(search().has(key)).toBe(false)
      }
      expect(search().get('branch')).toBe('main')
      expect(search().get('mode')).toBe('TABLE_NAME')
    })

    it('hides the source picker when there is a single source', async () => {
      renderPage(crowded, { kind: 'source-empty' }, ['main'], {
        sources: sources.slice(0, 1),
        selectedSourceId: 'manual:a',
      })
      await screen.findByText('abcdef1')
      expect(screen.queryByRole('combobox', { name: 'Schema' })).toBeNull()
    })
  })

  describe('commit badge', () => {
    it('links to the commit, with a translated title, when GitHub gave its address', async () => {
      renderPage('/acme/shop', { kind: 'source-empty' }, ['main'], {
        commitUrl: 'https://github.com/acme/shop/commit/abcdef1234567',
      })
      const link = await screen.findByRole('link', { name: 'abcdef1' })
      expect(link.getAttribute('href')).toBe('https://github.com/acme/shop/commit/abcdef1234567')
      expect(link.getAttribute('title')).toBe('Open commit abcdef1234567 on GitHub')
    })

    it('is plain text without an address', async () => {
      renderPage('/acme/shop', { kind: 'source-empty' }, ['main'])
      const badge = await screen.findByText('abcdef1')
      expect(badge.closest('a')).toBeNull()
    })
  })
})

function stubBranchSwitch(answer: (url: URL) => Partial<SchemaResponse>) {
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const requested = String(url)
      if (requested.includes('/schema')) {
        requests.push(requested)
        const base: SchemaResponse = {
          repo: { owner: 'acme', name: 'shop' },
          branch: 'main',
          commitSha: 'abcdef1234567',
          commitUrl: null,
          sources: [],
          selectedSourceId: null,
          schema: null,
          failure: { kind: 'source-empty' },
          treeTruncated: false,
        }
        return Response.json({ ...base, ...answer(new URL(requested, 'http://x')) })
      }
      if (requested.endsWith('/branches'))
        return Response.json({
          defaultBranch: 'main',
          branches: [{ name: 'main' }, { name: 'feature' }],
        })
      return Response.json({
        user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
        mode: 'real',
      })
    }),
  )
  return requests
}

async function pickFeature(user: ReturnType<typeof userEvent.setup>) {
  await openBranches(user)
  await user.keyboard('feat{Enter}')
}

describe('DiagramPage branch change', () => {
  it('keeps the source and resets the view selection', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/acme/shop?branch=main&source=manual%3Aa&active=users')
    const requests = stubBranchSwitch(() => ({}))
    renderWithApp(<DiagramPage owner="acme" repo="shop" />)
    await pickFeature(user)
    await vi.waitFor(() => expect(requests.some((r) => r.includes('branch=feature'))).toBe(true))
    const params = new URLSearchParams(window.location.search)
    expect(params.get('branch')).toBe('feature')
    expect(params.get('source')).toBe('manual:a')
    expect(params.has('active')).toBe(false)
    expect(requests.at(-1)).toContain('source=manual%3Aa')
  })

  it('falls back to the default source once, replacing the history entry', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/acme/shop?branch=main&source=manual%3Aa')
    const requests = stubBranchSwitch((url) =>
      url.searchParams.get('branch') === 'feature' && url.searchParams.get('source')
        ? { branch: 'feature', failure: { kind: 'source-not-found', sourceId: 'manual:a' } }
        : {},
    )
    renderWithApp(<DiagramPage owner="acme" repo="shop" />)
    await screen.findByRole('combobox', { name: /^Branch/ })
    await pickFeature(user)
    const length = window.history.length
    expect(
      await screen.findByText(
        'Source "manual:a" does not exist on this branch: showing the default source.',
      ),
    ).toBeTruthy()
    const params = new URLSearchParams(window.location.search)
    expect(params.get('branch')).toBe('feature')
    expect(params.has('source')).toBe(false)
    expect(window.history.length).toBe(length)
    expect(requests.at(-1)).not.toContain('source=')
  })

  it('redirects only once and shows the failure of the default source', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/acme/shop?branch=main&source=manual%3Aa')
    const requests = stubBranchSwitch((url) =>
      url.searchParams.get('branch') === 'feature'
        ? url.searchParams.get('source')
          ? { branch: 'feature', failure: { kind: 'source-not-found', sourceId: 'manual:a' } }
          : { branch: 'feature', failure: { kind: 'no-schema-found' } }
        : {},
    )
    renderWithApp(<DiagramPage owner="acme" repo="shop" />)
    await screen.findByRole('combobox', { name: /^Branch/ })
    await pickFeature(user)
    expect(await screen.findByText(/No Prisma or Drizzle schema/)).toBeTruthy()
    const featureRequests = requests.filter((r) => r.includes('branch=feature'))
    expect(featureRequests).toHaveLength(2)
  })

  it('keeps the default source button for a deep link', async () => {
    window.history.replaceState(null, '', '/acme/shop?branch=feature&source=manual%3Aold')
    stubBranchSwitch(() => ({
      branch: 'feature',
      failure: { kind: 'source-not-found', sourceId: 'manual:old' },
    }))
    renderWithApp(<DiagramPage owner="acme" repo="shop" />)
    expect(await screen.findByRole('link', { name: 'Show the default schema' })).toBeTruthy()
    expect(new URLSearchParams(window.location.search).get('source')).toBe('manual:old')
  })
})

describe('BranchPicker while branches load', () => {
  it('shows the loading label as value and accessible name', async () => {
    window.history.replaceState(null, '', '/acme/shop')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/branches')) return new Promise<Response>(() => {})
        if (String(url).includes('/schema')) return new Promise<Response>(() => {})
        return Response.json({
          user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
          mode: 'real',
        })
      }),
    )
    renderWithApp(<DiagramPage owner="acme" repo="shop" />)
    const picker = await screen.findByRole('combobox', { name: 'Branch: Loading…' })
    expect(picker.textContent).toBe('Loading…')
  })

  it('shows a failed branch list in the picker, with a retry', async () => {
    const user = userEvent.setup()
    renderPage('/acme/shop?branch=feature%2Fx', { kind: 'no-schema-found' }, [], {}, 500)
    await openBranches(user)
    expect(
      await screen.findByText('Could not load the branches: Unexpected server error.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
