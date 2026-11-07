// @vitest-environment jsdom
import type { TableGroupsResponse } from '@repoerd/contracts'
import { type DbSchema, GROUP_PALETTE, type Table } from '@repoerd/model'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramWorkspace } from '../../src/features/diagram/DiagramWorkspace'
import { fakeGroupsServer } from '../groups-server'
import { renderWithApp } from '../render'

const layout = vi.hoisted(() => {
  const placed = new Map([
    ['invoices', { x: 0, y: 0 }],
    ['users', { x: 400, y: 0 }],
  ])
  return {
    placed,
    placeTables: vi.fn(async () => ({ positions: placed, added: [] })),
    layoutTables: vi.fn(
      async () =>
        new Map([
          ['invoices', { x: 10.4, y: 20 }],
          ['users', { x: 900, y: 0 }],
        ]),
    ),
  }
})

vi.mock('../../src/features/diagram/layout/place-tables', () => ({
  placeTables: layout.placeTables,
}))
vi.mock('../../src/features/diagram/layout/auto-layout', () => ({
  layoutTables: layout.layoutTables,
}))

const table = (name: string, file: string): Table => ({
  name,
  schema: null,
  comment: null,
  columns: [],
  indexes: [],
  constraints: [],
  file,
})
const schema: DbSchema = {
  tables: { invoices: table('invoices', 'db/billing.ts'), users: table('users', 'db/users.ts') },
  enums: {},
  relationships: [],
}
const billing = {
  id: 'billing',
  name: 'billing',
  color: GROUP_PALETTE[0] as string,
  origins: [{ kind: 'file' as const, path: 'db/billing.ts' }],
}
const configured: Omit<TableGroupsResponse, 'canEdit'> = {
  configured: true,
  groups: [billing],
  assignments: {},
}
const notConfigured: Omit<TableGroupsResponse, 'canEdit'> = {
  configured: false,
  groups: [],
  assignments: {},
}
const SAVED = [
  { table: 'invoices', x: 0, y: 0 },
  { table: 'users', x: 400, y: 0 },
]

// The offer is remembered per page visit and repository: every test opens a repository of its own.
let repoCount = 0
const nextRepo = () => ({ owner: 'acme', name: `shop${++repoCount}` })
const offerKey = (repo: { owner: string; name: string }) =>
  `repoerd:group-layout-offer:${repo.owner}/${repo.name}:db`

const OFFER = 'Lay out my diagram by group'

function renderWorkspace(
  repo: { owner: string; name: string },
  { groups = configured, positions = SAVED, canEdit = true, strict = false } = {},
) {
  const server = fakeGroupsServer(groups, { positions, canEdit })
  renderWithApp(
    <DiagramWorkspace
      repo={repo}
      schema={schema}
      sourceId="db"
      viewState={{ hidden: [], mode: 'ALL_FIELDS' }}
      updateView={vi.fn()}
    />,
    server.client,
    { reactStrictMode: strict },
  )
  return server
}

/** The canvas is placed and the groups are loaded (their frames are labelled). */
async function settled() {
  await waitFor(() => expect(document.querySelector('.group-frame__label')).toBeTruthy())
  await waitFor(() => expect(document.querySelector('.react-flow__node')).toBeTruthy())
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
}

const layoutSaves = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(
      ([path, init]) => String(path).includes('/layout') && init?.method === 'PATCH',
    )

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('the offer to lay out the diagram by group', () => {
  it('is made when saved groups meet a layout saved before this visit', async () => {
    renderWorkspace(nextRepo())
    expect(await screen.findByRole('button', { name: OFFER })).toBeTruthy()
  })

  it('is made once under StrictMode, which mounts the canvas twice', async () => {
    const repo = nextRepo()
    renderWorkspace(repo, { strict: true })
    expect(await screen.findByRole('button', { name: OFFER })).toBeTruthy()
    // The notice of the first mount goes away with it.
    await waitFor(() => expect(screen.getAllByRole('button', { name: OFFER })).toHaveLength(1))
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
    expect(screen.getAllByRole('button', { name: OFFER })).toHaveLength(1)
    expect(window.localStorage.getItem(offerKey(repo))).toBeNull()
  })

  it('goes through the confirmation of "Rearrange all", then saves the positions by group', async () => {
    const repo = nextRepo()
    renderWorkspace(repo)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: OFFER }))

    // Used: it is not made again, even if the confirmation is cancelled afterwards.
    expect(window.localStorage.getItem(offerKey(repo))).not.toBeNull()
    expect(await screen.findByText('Rearrange all tables?')).toBeTruthy()
    expect(layout.layoutTables).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Rearrange' }))

    await waitFor(() => expect(layout.layoutTables).toHaveBeenCalledTimes(1))
    expect(layout.layoutTables).toHaveBeenCalledWith(
      schema,
      ['invoices', 'users'],
      'ALL_FIELDS',
      new Map([
        ['invoices', 'billing'],
        ['users', null],
      ]),
    )
    await waitFor(() => expect(layoutSaves()).toHaveLength(1), { timeout: 3000 })
    expect(JSON.parse(String(layoutSaves()[0]?.[1]?.body))).toEqual({
      positions: [
        { table: 'invoices', x: 10, y: 20 },
        { table: 'users', x: 900, y: 0 },
      ],
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: OFFER })).toBeNull())
  })

  it('is not made again once declined', async () => {
    const repo = nextRepo()
    renderWorkspace(repo)
    const user = userEvent.setup()
    await screen.findByRole('button', { name: OFFER })
    await user.click(screen.getByRole('button', { name: 'No thanks' }))
    expect(window.localStorage.getItem(offerKey(repo))).not.toBeNull()
    await waitFor(() => expect(screen.queryByRole('button', { name: OFFER })).toBeNull())
    expect(layout.layoutTables).not.toHaveBeenCalled()

    cleanup()
    renderWorkspace(repo)
    await settled()
    expect(screen.queryByRole('button', { name: OFFER })).toBeNull()
  })

  it('is made again on a later visit when it was neither used nor declined', async () => {
    const repo = nextRepo()
    renderWorkspace(repo)
    await screen.findByRole('button', { name: OFFER })
    cleanup()
    // Leaving the diagram takes the notice away without marking it as seen.
    expect(screen.queryByRole('button', { name: OFFER })).toBeNull()
    expect(window.localStorage.getItem(offerKey(repo))).toBeNull()
    renderWorkspace(repo)
    expect(await screen.findByRole('button', { name: OFFER })).toBeTruthy()
  })

  it('is not made on a first visit, nor once that visit has placed the tables', async () => {
    const repo = nextRepo()
    renderWorkspace(repo, { positions: [] })
    await settled()
    expect(screen.queryByRole('button', { name: OFFER })).toBeNull()

    // The canvas mounts again in the same visit, now with the positions it saved.
    cleanup()
    renderWorkspace(repo)
    await settled()
    expect(screen.queryByRole('button', { name: OFFER })).toBeNull()
  })

  it('is not made for groups that are only proposed', async () => {
    renderWorkspace(nextRepo(), { groups: notConfigured })
    await settled()
    expect(screen.getByRole('button', { name: 'Save for the team' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: OFFER })).toBeNull()
  })

  it('is not made when it was already shown', async () => {
    const repo = nextRepo()
    window.localStorage.setItem(offerKey(repo), 'shown')
    renderWorkspace(repo)
    await settled()
    expect(screen.queryByRole('button', { name: OFFER })).toBeNull()
  })

  it('is made without the right to edit the groups: the layout is the user’s own', async () => {
    renderWorkspace(nextRepo(), { canEdit: false })
    expect(await screen.findByRole('button', { name: OFFER })).toBeTruthy()
  })

  it('is not made, and nothing fails, when the browser storage cannot be used', async () => {
    const throwing = () => {
      throw new DOMException('denied', 'SecurityError')
    }
    vi.stubGlobal('localStorage', {
      getItem: throwing,
      setItem: throwing,
      removeItem: throwing,
      clear: () => {},
    })
    expect(() => window.localStorage.getItem('any')).toThrow()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderWorkspace(nextRepo())
    await settled()
    expect(screen.queryByRole('button', { name: OFFER })).toBeNull()
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
