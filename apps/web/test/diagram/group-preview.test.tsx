// @vitest-environment jsdom
import type { TableGroupsResponse } from '@repoerd/contracts'
import { type DbSchema, GROUP_PALETTE, type Table } from '@repoerd/model'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramWorkspace } from '../../src/features/diagram/DiagramWorkspace'
import type { ViewState } from '../../src/features/diagram/view-state'
import { i18n } from '../../src/shared/i18n/i18n'
import { fakeGroupsServer } from '../groups-server'
import { renderWithApp } from '../render'

const layout = vi.hoisted(() => {
  const placed = new Map([
    ['invoices', { x: 0, y: 0 }],
    ['users', { x: 400, y: 0 }],
  ])
  return {
    placeTables: vi.fn(async () => ({ positions: placed, added: [] })),
    layoutTables: vi.fn(async (_schema: unknown, names: readonly string[]) => {
      return new Map(names.map((name, i) => [name, { x: i * 400, y: 0 }]))
    }),
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
// Saved: only invoices is grouped. The files propose a group for users too.
const money = {
  id: 'money',
  name: 'Money',
  color: GROUP_PALETTE[0] as string,
  origins: [{ kind: 'file' as const, path: 'db/billing.ts' }],
}
const saved: Omit<TableGroupsResponse, 'canEdit'> = {
  configured: true,
  groups: [money],
  assignments: {},
}
const SAVED_MEMBERSHIP = new Map<string, string | null>([
  ['invoices', 'money'],
  ['users', null],
])
const repo = { owner: 'acme', name: 'shop' }
const REPROPOSE = 'Propose again from the files'

function renderWorkspace(initial: ViewState = { hidden: [], mode: 'ALL_FIELDS' }) {
  // The offer to lay out by group is not what these tests are about.
  window.localStorage.setItem('repoerd:group-layout-offer:acme/shop:db', 'shown')
  const server = fakeGroupsServer(saved, {
    positions: [
      { table: 'invoices', x: 0, y: 0 },
      { table: 'users', x: 400, y: 0 },
    ],
  })
  let setViewState: (next: ViewState) => void = () => {}
  function Workspace() {
    const [viewState, setCurrent] = useState<ViewState>(initial)
    setViewState = setCurrent
    return (
      <DiagramWorkspace
        repo={repo}
        schema={schema}
        sourceId="db"
        viewState={viewState}
        updateView={vi.fn()}
      />
    )
  }
  renderWithApp(<Workspace />, server.client)
  return { server, view: (next: ViewState) => act(() => setViewState(next)) }
}

async function repropose() {
  await userEvent.setup().click(await screen.findByRole('button', { name: REPROPOSE }))
  await waitFor(() => expect(document.querySelector('.group-frame--proposed')).toBeTruthy())
}

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  window.localStorage.clear()
  await i18n.changeLanguage('en')
})

describe('the proposals shown again over the saved groups (a preview)', () => {
  it('leaves "Rearrange all" to the saved groups', async () => {
    renderWorkspace()
    await repropose()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Rearrange all tables' }))
    await user.click(await screen.findByRole('button', { name: 'Rearrange' }))

    await waitFor(() => expect(layout.layoutTables).toHaveBeenCalledTimes(1))
    expect(layout.layoutTables).toHaveBeenCalledWith(
      schema,
      ['invoices', 'users'],
      'ALL_FIELDS',
      SAVED_MEMBERSHIP,
    )
  })

  it('leaves the related view to the saved groups', async () => {
    const { view } = renderWorkspace()
    await repropose()
    await view({ hidden: [], mode: 'ALL_FIELDS', focus: 'invoices' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Back to full schema/ })).toBeTruthy(),
    )
    const card = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('.react-flow__node[data-id="invoices"]')
      if (!node) throw new Error('no card')
      return node
    })
    // The saved group's name, not the proposed one's ("billing").
    expect(card.querySelector('.table-node__group-tag')?.textContent).toBe('Money')
  })

  it('says in the details that the group shown is a preview', async () => {
    renderWorkspace({ hidden: [], mode: 'ALL_FIELDS', active: 'users' })
    const panel = within(await screen.findByRole('complementary', { name: 'Details of users' }))
    await panel.findByRole('combobox', { name: 'Group' })
    await repropose()
    const line = await panel.findByText('Group')
    expect(line.closest('p')?.textContent).toContain('users')
    expect(line.closest('p')?.textContent).toContain('preview, not saved')

    await i18n.changeLanguage('fr')
    await waitFor(() =>
      expect(panel.getByText('Groupe').closest('p')?.textContent).toContain(
        'aperçu, non enregistré',
      ),
    )
  })
})
