// @vitest-environment jsdom
import type { TableGroupsResponse } from '@repoerd/contracts'
import { type DbSchema, GROUP_PALETTE, type Table } from '@repoerd/model'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramWorkspace } from '../../src/features/diagram/DiagramWorkspace'
import { i18n } from '../../src/shared/i18n/i18n'
import { fakeGroupsServer } from '../groups-server'
import { renderWithApp } from '../render'

vi.mock('../../src/features/diagram/layout/place-tables', () => ({
  placeTables: vi.fn(async (_schema: unknown, names: readonly string[]) => ({
    positions: new Map(names.map((name, i) => [name, { x: i * 400, y: 0 }])),
    added: [],
  })),
}))
vi.mock('../../src/features/diagram/layout/auto-layout', () => ({
  layoutTables: vi.fn(async (_schema: unknown, names: readonly string[]) => {
    return new Map(names.map((name, i) => [name, { x: i * 400, y: 0 }]))
  }),
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
// One file, one Postgres schema: nothing to propose.
const oneFile: DbSchema = {
  tables: { invoices: table('invoices', 'schema.prisma'), users: table('users', 'schema.prisma') },
  enums: {},
  relationships: [],
}
const twoFiles: DbSchema = {
  tables: { invoices: table('invoices', 'db/billing.ts'), users: table('users', 'db/users.ts') },
  enums: {},
  relationships: [],
}
type Saved = Omit<TableGroupsResponse, 'canEdit'>
const nothingSaved: Saved = { configured: false, groups: [], assignments: {} }
const noGroups: Saved = { configured: true, groups: [], assignments: {} }
const oneGroup: Saved = {
  configured: true,
  groups: [
    {
      id: 'money',
      name: 'Money',
      color: GROUP_PALETTE[0] as string,
      origins: [{ kind: 'file', path: 'db/billing.ts' }],
    },
  ],
  assignments: {},
}

const REPROPOSE = 'Propose again from the files'
const CREATE = 'Create a group'

function renderWorkspace(schema: DbSchema, saved: Saved, { canEdit = true } = {}) {
  // The offer to lay out by group is not what these tests are about.
  window.localStorage.setItem('repoerd:group-layout-offer:acme/shop:db', 'shown')
  const server = fakeGroupsServer(saved, { canEdit })
  renderWithApp(
    <DiagramWorkspace
      repo={{ owner: 'acme', name: 'shop' }}
      schema={schema}
      sourceId="db"
      viewState={{ hidden: [], mode: 'ALL_FIELDS' }}
      updateView={vi.fn()}
    />,
    server.client,
  )
  return server
}

// The groups have been received once the table list shows its sections or the cards are placed.
const cardsPlaced = () =>
  waitFor(() => expect(document.querySelector('.react-flow__node[data-id="users"]')).toBeTruthy())

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  window.localStorage.clear()
  await i18n.changeLanguage('en')
})

describe('"Propose again" when the files propose nothing', () => {
  it('stays in the toolbar, unavailable, and says why', async () => {
    renderWorkspace(oneFile, nothingSaved)
    const button = await screen.findByRole('button', { name: REPROPOSE })
    expect(button.getAttribute('aria-disabled')).toBe('true')

    const user = userEvent.setup()
    await user.hover(button)
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip.textContent).toContain('Nothing to propose')
    expect(tooltip.textContent).toContain('one file and one Postgres schema')

    await user.click(button)
    expect(document.querySelector('.group-frame--proposed')).toBeNull()
  })

  it('is also unavailable once the team has saved its groups', async () => {
    renderWorkspace(oneFile, noGroups)
    const button = await screen.findByRole('button', { name: REPROPOSE })
    expect(button.getAttribute('aria-disabled')).toBe('true')
  })

  it('stays hidden while the proposals are shown with their banner', async () => {
    renderWorkspace(twoFiles, nothingSaved)
    await screen.findByRole('button', { name: 'Save for the team' })
    expect(screen.queryByRole('button', { name: REPROPOSE })).toBeNull()
  })

  it('is available when the files propose groups and the team has saved none', async () => {
    renderWorkspace(twoFiles, noGroups)
    const button = await screen.findByRole('button', { name: REPROPOSE })
    expect(button.getAttribute('aria-disabled')).toBeNull()
    await userEvent.setup().click(button)
    await waitFor(() => expect(document.querySelector('.group-frame--proposed')).toBeTruthy())
  })

  it('is not shown without the right to edit the groups', async () => {
    renderWorkspace(oneFile, nothingSaved, { canEdit: false })
    await cardsPlaced()
    expect(screen.queryByRole('button', { name: REPROPOSE })).toBeNull()
  })
})

describe('"Create a group" in the toolbar', () => {
  it('explains how to make a group when the source has none', async () => {
    renderWorkspace(oneFile, nothingSaved)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: CREATE }))

    const help = within(await screen.findByRole('dialog', { name: CREATE }))
    expect(help.getByText(/Shift\+click each one, or Shift\+drag/)).toBeTruthy()
    expect(help.getByText(/choose "New group…" and name it/)).toBeTruthy()
    expect(help.getByText(/With the keyboard/)).toBeTruthy()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: CREATE })).toBeNull())
  })

  it('is shown when the team saved no group, beside "Propose again"', async () => {
    renderWorkspace(twoFiles, noGroups)
    await screen.findByRole('button', { name: CREATE })
    expect(screen.getByRole('button', { name: REPROPOSE })).toBeTruthy()
  })

  it('is not shown once there are groups, saved or proposed', async () => {
    renderWorkspace(twoFiles, oneGroup)
    await screen.findByRole('button', { name: REPROPOSE })
    expect(screen.queryByRole('button', { name: CREATE })).toBeNull()
    cleanup()
    vi.unstubAllGlobals()

    renderWorkspace(twoFiles, nothingSaved)
    await screen.findByRole('button', { name: 'Save for the team' })
    expect(screen.queryByRole('button', { name: CREATE })).toBeNull()
  })

  it('is not shown without the right to edit the groups', async () => {
    renderWorkspace(oneFile, nothingSaved, { canEdit: false })
    await cardsPlaced()
    expect(screen.queryByRole('button', { name: CREATE })).toBeNull()
  })

  it('speaks French', async () => {
    await i18n.changeLanguage('fr')
    renderWorkspace(oneFile, nothingSaved)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Créer un groupe' }))
    const help = within(await screen.findByRole('dialog', { name: 'Créer un groupe' }))
    expect(help.getByText(/Maj\+clic sur chacune/)).toBeTruthy()
    expect(help.getByText(/choisissez « Nouveau groupe… »/)).toBeTruthy()
  })
})
