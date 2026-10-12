// @vitest-environment jsdom
import type { CompareResponse, SchemaResponse } from '@repoerd/contracts'
import type { DbSchema } from '@repoerd/model'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramPage } from '../../src/features/diagram/DiagramPage'
import { renderWithApp } from '../render'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const tableOf = (name: string, columns: string[]) => ({
  name,
  schema: null,
  comment: null,
  columns: columns.map((column) => ({
    name: column,
    type: 'text',
    notNull: false,
    default: null,
    comment: null,
    isPrimaryKey: column === 'id',
    isUnique: false,
  })),
  indexes: [],
  constraints: [],
})
const schemaOf = (...tables: ReturnType<typeof tableOf>[]): DbSchema => ({
  tables: Object.fromEntries(tables.map((t) => [t.name, t])),
  enums: {},
  relationships: [],
})

function comparison(overrides: Partial<CompareResponse> = {}): CompareResponse {
  return {
    repo: { owner: 'acme', name: 'shop' },
    mode: 'merge-base',
    base: { branch: 'main', commitSha: 'aaaaaaa1111', commitUrl: null },
    head: { branch: 'feature/x', commitSha: 'bbbbbbb2222', commitUrl: null },
    mergeBaseSha: 'ccccccc3333',
    before: {
      commitSha: 'ccccccc3333',
      commitUrl: null,
      schema: schemaOf(tableOf('users', ['id'])),
      failure: null,
    },
    after: {
      commitSha: 'bbbbbbb2222',
      commitUrl: null,
      schema: schemaOf(tableOf('users', ['id', 'email']), tableOf('reviews', ['id'])),
      failure: null,
    },
    sources: [
      { id: 'prisma/schema.prisma', name: 'prisma/schema.prisma', format: 'prisma', problem: null },
    ],
    selectedSourceId: 'prisma/schema.prisma',
    treeTruncated: false,
    ...overrides,
  }
}

const NO_SCHEMA: SchemaResponse = {
  repo: { owner: 'acme', name: 'shop' },
  branch: 'feature/x',
  commitSha: 'bbbbbbb2222',
  commitUrl: null,
  sources: [],
  selectedSourceId: null,
  schema: null,
  failure: { kind: 'no-schema-found' },
  treeTruncated: false,
}

function renderPage(path: string, compare: () => Response = () => Response.json(comparison())) {
  window.history.replaceState(null, '', path)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const requested = String(url)
      if (requested.includes('/compare')) return compare()
      // The canvas waits for the layout: these tests look at everything around it.
      if (requested.includes('/layout')) return new Promise<Response>(() => {})
      if (requested.includes('/schema')) return Response.json(NO_SCHEMA)
      if (requested.endsWith('/branches'))
        return Response.json({
          defaultBranch: 'main',
          branches: ['main', 'feature/x'].map((name) => ({ name, commitSha: name })),
        })
      return Response.json({
        user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
        mode: 'real',
      })
    }),
  )
  renderWithApp(<DiagramPage owner="acme" repo="shop" />)
}

const enabled = async (name: string | RegExp) => {
  const button = (await screen.findByRole('button', { name })) as HTMLButtonElement
  await vi.waitFor(() => expect(button.disabled).toBe(false))
  return button
}

describe('Comparing branches', () => {
  it('starts a comparison with the default branch as reference', async () => {
    const user = userEvent.setup()
    renderPage('/acme/shop?branch=feature%2Fx')
    await user.click(await enabled('Compare'))
    const dialog = within(screen.getByRole('dialog'))
    expect(
      dialog.getByRole('combobox', { name: 'Reference branch (before)' }).textContent,
    ).toContain('main')
    await user.click(dialog.getByRole('button', { name: 'Compare' }))
    expect(window.location.search).toBe('?branch=feature%2Fx&compare=main')
  })

  it('shows the comparison bar, its summary and the Changes tab', async () => {
    renderPage('/acme/shop?branch=feature%2Fx&compare=main')
    const bar = await screen.findByRole('region', { name: 'Comparison' })
    expect(bar.textContent).toContain('feature/x compared with main')
    expect(bar.textContent).toContain('since the fork point')
    expect(await within(bar).findByText('1 new table')).toBeTruthy()
    expect(within(bar).getByText('1 modified table')).toBeTruthy()
    expect(await screen.findByRole('tab', { name: 'Changes (2)', selected: true })).toBeTruthy()
    const tables = within(screen.getByRole('region', { name: 'Tables' }))
    expect(tables.getByRole('button', { name: /^reviews/ })).toBeTruthy()
    expect(tables.getByRole('button', { name: /^users/ })).toBeTruthy()
  })

  it('swaps with the resolved branch name when the URL names no branch', async () => {
    const user = userEvent.setup()
    renderPage('/acme/shop?compare=feature%2Fx', () =>
      Response.json(
        comparison({
          base: { branch: 'feature/x', commitSha: 'b', commitUrl: null },
          head: { branch: 'main', commitSha: 'a', commitUrl: null },
        }),
      ),
    )
    await user.click(await enabled('Swap the branches'))
    expect(window.location.search).toBe('?branch=feature%2Fx&compare=main')
  })

  it('leaves the comparison when the reference branch is picked as displayed branch', async () => {
    const user = userEvent.setup()
    renderPage('/acme/shop?branch=feature%2Fx&compare=main')
    const picker = (await screen.findByRole('combobox', { name: /^Branch/ })) as HTMLButtonElement
    await vi.waitFor(() => expect(picker.disabled).toBe(false))
    await user.click(picker)
    await user.click(screen.getByRole('option', { name: 'main' }))
    expect(window.location.search).toBe('?branch=main')
  })

  it('leaves the comparison from its bar', async () => {
    const user = userEvent.setup()
    renderPage('/acme/shop?branch=feature%2Fx&compare=main&diff=direct&changed=1')
    await user.click(await screen.findByRole('button', { name: 'Leave the comparison' }))
    expect(window.location.search).toBe('?branch=feature%2Fx')
  })

  it('says when nothing changed', async () => {
    const same = schemaOf(tableOf('users', ['id']))
    renderPage('/acme/shop?branch=feature%2Fx&compare=main', () =>
      Response.json(
        comparison({
          before: { commitSha: 'b', commitUrl: null, schema: same, failure: null },
          after: { commitSha: 'b', commitUrl: null, schema: same, failure: null },
        }),
      ),
    )
    expect(await screen.findByText('No schema change between these branches.')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /^Changes/ })).toBeNull()
  })

  it('offers a direct comparison when the branches share no history', async () => {
    const user = userEvent.setup()
    renderPage('/acme/shop?branch=feature%2Fx&compare=main', () =>
      Response.json({ error: { code: 'no_common_history', message: 'x' } }, { status: 409 }),
    )
    await user.click(await screen.findByRole('button', { name: 'Compare directly' }))
    expect(window.location.search).toBe('?branch=feature%2Fx&compare=main&diff=direct')
  })

  it('names the missing reference branch', async () => {
    renderPage('/acme/shop?branch=feature%2Fx&compare=gone', () =>
      Response.json(
        {
          error: {
            code: 'branch_not_found',
            message: 'x',
            details: { branch: 'gone', side: 'base' },
          },
        },
        { status: 404 },
      ),
    )
    expect(await screen.findByText('The reference branch "gone" does not exist.')).toBeTruthy()
  })

  it('names the side that could not be parsed', async () => {
    renderPage('/acme/shop?branch=feature%2Fx&compare=main', () =>
      Response.json(
        comparison({
          after: {
            commitSha: 'bbbbbbb2222',
            commitUrl: null,
            schema: null,
            failure: { kind: 'parse-error', message: 'boom' },
          },
        }),
      ),
    )
    expect(await screen.findByText('Compared side (feature/x, bbbbbbb):')).toBeTruthy()
    expect(screen.getByText(/boom/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Show feature/x alone' }).getAttribute('href')).toBe(
      '/acme/shop?branch=feature%2Fx',
    )
  })

  it('offers the current state and a direct comparison when the fork point fails', async () => {
    const user = userEvent.setup()
    renderPage('/acme/shop?branch=feature%2Fx&compare=main', () =>
      Response.json(
        comparison({
          before: {
            commitSha: 'ccccccc3333',
            commitUrl: null,
            schema: null,
            failure: { kind: 'parse-error', message: 'old syntax' },
          },
        }),
      ),
    )
    expect(await screen.findByText('Reference side (main, ccccccc):')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Show main (current state)' }).getAttribute('href'),
    ).toBe('/acme/shop?branch=main')
    await user.click(screen.getByRole('button', { name: 'Compare directly' }))
    expect(window.location.search).toContain('diff=direct')
  })
})
