// @vitest-environment jsdom
import type { TableGroupsResponse } from '@repoerd/contracts'
import { type DbSchema, GROUP_PALETTE, proposeGroups, type Table } from '@repoerd/model'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramWorkspace } from '../../src/features/diagram/DiagramWorkspace'
import { i18n } from '../../src/shared/i18n/i18n'
import { fakeGroupsServer, writes } from '../groups-server'
import { renderWithApp } from '../render'

const { PLACED } = vi.hoisted(() => ({
  PLACED: new Map([
    ['invoices', { x: 0, y: 0 }],
    ['payments', { x: 400, y: 0 }],
    ['users', { x: 1200, y: 0 }],
    ['sessions', { x: 1600, y: 0 }],
  ]),
}))

vi.mock('../../src/features/diagram/layout/place-tables', () => ({
  placeTables: async () => ({ positions: PLACED, added: [] }),
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
  tables: Object.fromEntries(
    [
      table('invoices', 'db/billing.ts'),
      table('payments', 'db/billing.ts'),
      table('users', 'db/users.ts'),
      table('sessions', 'db/users.ts'),
    ].map((t) => [t.name, t]),
  ),
  enums: {},
  relationships: [],
}

const billing = {
  id: 'billing',
  name: 'billing',
  color: GROUP_PALETTE[0] as string,
  origins: [{ kind: 'file' as const, path: 'db/billing.ts' }],
}
const accounts = {
  id: 'accounts',
  name: 'Accounts',
  color: GROUP_PALETTE[1] as string,
  origins: [{ kind: 'file' as const, path: 'db/users.ts' }],
}
const configured: Omit<TableGroupsResponse, 'canEdit'> = {
  configured: true,
  groups: [billing, accounts],
  assignments: { users: 'accounts' },
}

const repo = { owner: 'acme', name: 'shop' }

function renderWorkspace(
  state: Omit<TableGroupsResponse, 'canEdit'> = configured,
  { canEdit = true } = {},
) {
  const server = fakeGroupsServer(state, { canEdit })
  const updateView = vi.fn()
  renderWithApp(
    <DiagramWorkspace
      repo={repo}
      schema={schema}
      sourceId="db"
      viewState={{ hidden: [], mode: 'ALL_FIELDS' }}
      updateView={updateView}
    />,
    server.client,
  )
  return { server, updateView }
}

const labelButton = (name: string) =>
  screen.findByRole('button', { name: `Edit the group ${name}` })

async function openEditor(name: string) {
  const user = userEvent.setup()
  await user.click(await labelButton(name))
  const dialog = await screen.findByRole('dialog', { name: `Edit the group ${name}` })
  return { user, dialog: within(dialog) }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the group label editor', () => {
  it('turns the label into a button that does not pan the canvas nor activate a table', async () => {
    const { updateView } = renderWorkspace()
    const label = await labelButton('billing')
    expect(label.tagName).toBe('BUTTON')
    expect(label.classList).toContain('nopan')
    expect(label.classList).toContain('group-frame__label')
    await openEditor('billing')
    expect(updateView).not.toHaveBeenCalledWith(
      expect.objectContaining({ active: expect.anything() }),
    )
  })

  it('renames the group with the trimmed name', async () => {
    const { server } = renderWorkspace()
    const { user, dialog } = await openEditor('billing')
    const name = dialog.getByRole('textbox', { name: 'Name' })
    expect((name as HTMLInputElement).value).toBe('billing')
    expect(name.getAttribute('maxlength')).toBe('80')
    await user.clear(name)
    await user.type(name, '  Facturation {Enter}')
    await waitFor(() => expect(server.sent).toHaveLength(1))
    expect(server.sent[0]).toEqual({
      method: 'PUT',
      path: '/api/repos/acme/shop/groups/billing?source=db',
      body: { name: 'Facturation', color: billing.color, origins: billing.origins },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit the group Facturation' })))
  })

  it('refuses an empty name: the button is disabled and nothing is sent', async () => {
    const { server } = renderWorkspace()
    const { user, dialog } = await openEditor('billing')
    const name = dialog.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, '   ')
    expect((dialog.getByRole('button', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    await user.type(name, '{Enter}')
    await act(async () => {})
    expect(server.sent).toEqual([])
  })

  it('recolours the group from a palette swatch, the current one pressed', async () => {
    const { server } = renderWorkspace()
    const { user, dialog } = await openEditor('billing')
    expect(dialog.getAllByRole('button', { name: /^Color \d+$/ })).toHaveLength(12)
    expect(dialog.getByRole('button', { name: 'Color 1' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(dialog.getByRole('button', { name: 'Color 3' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    await user.click(dialog.getByRole('button', { name: 'Color 3' }))
    await waitFor(() => expect(server.sent).toHaveLength(1))
    expect(server.sent[0]).toMatchObject({
      method: 'PUT',
      path: '/api/repos/acme/shop/groups/billing?source=db',
      body: { name: 'billing', color: GROUP_PALETTE[2] },
    })
    await waitFor(() =>
      expect(dialog.getByRole('button', { name: 'Color 3' }).getAttribute('aria-pressed')).toBe(
        'true',
      ),
    )
  })

  it('recolours the group with a custom colour, lower-cased', async () => {
    const { server } = renderWorkspace()
    const { dialog } = await openEditor('billing')
    fireEvent.change(dialog.getByLabelText('Custom color'), { target: { value: '#ABCDEF' } })
    await waitFor(() => expect(server.sent).toHaveLength(1))
    expect(server.sent[0]).toMatchObject({ method: 'PUT', body: { color: '#abcdef' } })
  })

  it('deletes the group, with a notice to undo it', async () => {
    const { server } = renderWorkspace()
    const { user, dialog } = await openEditor('billing')
    await user.click(dialog.getByRole('button', { name: 'Delete the group' }))
    await waitFor(() => expect(server.sent).toHaveLength(1))
    expect(writes(server)).toEqual(['DELETE /api/repos/acme/shop/groups/billing?source=db'])
    expect(await screen.findByText('Group "billing" deleted.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(server.sent).toHaveLength(2))
    expect(server.sent[1]).toMatchObject({
      method: 'PUT',
      path: '/api/repos/acme/shop/groups/billing?source=db',
      body: { name: 'billing' },
    })
  })

  it('gives the focus to the next label once a group is deleted, else to the previous one', async () => {
    renderWorkspace()
    let { user, dialog } = await openEditor('billing')
    await user.click(dialog.getByRole('button', { name: 'Delete the group' }))
    const accounts = await labelButton('Accounts')
    await waitFor(() => expect(document.activeElement).toBe(accounts))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Edit the group billing' })).toBeNull(),
    )

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await labelButton('billing')
    ;({ user, dialog } = await openEditor('Accounts'))
    await user.click(dialog.getByRole('button', { name: 'Delete the group' }))
    const billingLabel = await labelButton('billing')
    await waitFor(() => expect(document.activeElement).toBe(billingLabel))
  })

  it('offers no editing while the proposals are shown again', async () => {
    const server = fakeGroupsServer(configured)
    renderWithApp(
      <DiagramWorkspace
        repo={repo}
        schema={schema}
        sourceId="db"
        viewState={{ hidden: [], mode: 'ALL_FIELDS', active: 'users' }}
        updateView={vi.fn()}
      />,
      server.client,
    )
    await labelButton('billing')
    const panel = within(await screen.findByRole('complementary', { name: 'Details of users' }))
    await panel.findByRole('combobox', { name: 'Group' })
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Propose again from the files' }))
    await waitFor(() => expect(document.querySelector('.group-frame--proposed')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^Edit the group/ })).toBeNull()
    for (const label of document.querySelectorAll('.group-frame__label')) {
      expect(label.tagName).toBe('SPAN')
    }
    expect(panel.queryByRole('combobox')).toBeNull()
    expect(panel.getByText('users', { selector: 'p span' }).closest('p')?.textContent).toContain(
      'Group',
    )
    expect(server.sent).toEqual([])
  })

  it('is reached with Tab and opened with Enter', async () => {
    renderWorkspace()
    const label = await labelButton('billing')
    const user = userEvent.setup()
    for (let i = 0; i < 200 && document.activeElement !== label; i++) await user.tab()
    expect(document.activeElement).toBe(label)
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Edit the group billing' })).toBeTruthy()
  })

  it('saves the proposals first when a proposed group is renamed', async () => {
    const { server } = renderWorkspace({ configured: false, groups: [], assignments: {} })
    const proposals = proposeGroups(schema)
    const proposed = proposals.find((g) => g.name === 'billing')
    const { user, dialog } = await openEditor('billing')
    const name = dialog.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Facturation')
    await user.click(dialog.getByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(server.sent).toHaveLength(2))
    expect(writes(server)).toEqual([
      'PUT /api/repos/acme/shop/groups?source=db',
      `PUT /api/repos/acme/shop/groups/${proposed?.id}?source=db`,
    ])
    expect(server.sent[0]?.body).toEqual({ groups: proposals, assignments: {} })
    expect(server.sent[1]?.body).toMatchObject({ name: 'Facturation' })
  })

  it('keeps the label inert text without the push right', async () => {
    const { server } = renderWorkspace(configured, { canEdit: false })
    await waitFor(() => expect(document.querySelector('.group-frame__label')).toBeTruthy())
    const label = document.querySelector('.group-frame__label') as HTMLElement
    expect(label.tagName).toBe('SPAN')
    expect(screen.queryByRole('button', { name: /^Edit the group/ })).toBeNull()
    fireEvent.click(label)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(server.sent).toEqual([])
  })

  it('offers the group of the active table in its details', async () => {
    const server = fakeGroupsServer(configured)
    renderWithApp(
      <DiagramWorkspace
        repo={repo}
        schema={schema}
        sourceId="db"
        viewState={{ hidden: [], mode: 'ALL_FIELDS', active: 'users' }}
        updateView={vi.fn()}
      />,
      server.client,
    )
    const panel = within(await screen.findByRole('complementary', { name: 'Details of users' }))
    const select = await panel.findByRole('combobox', { name: 'Group' })
    expect(select.textContent).toContain('Accounts')
    const user = userEvent.setup()
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: 'Follow its file' }))
    await waitFor(() => expect(server.sent).toHaveLength(1))
    expect(server.sent[0]?.body).toEqual({ assignments: {}, clear: ['users'] })
  })

  it('does not offer to follow its file to a table that has none', async () => {
    const server = fakeGroupsServer(configured)
    const { file: _, ...users } = schema.tables.users as Table
    renderWithApp(
      <DiagramWorkspace
        repo={repo}
        schema={{ ...schema, tables: { ...schema.tables, users } }}
        sourceId="db"
        viewState={{ hidden: [], mode: 'ALL_FIELDS', active: 'users' }}
        updateView={vi.fn()}
      />,
      server.client,
    )
    const panel = within(await screen.findByRole('complementary', { name: 'Details of users' }))
    const user = userEvent.setup()
    await user.click(await panel.findByRole('combobox', { name: 'Group' }))
    expect(await screen.findByRole('option', { name: 'Ungrouped' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Follow its file' })).toBeNull()
  })

  it('speaks French', async () => {
    await i18n.changeLanguage('fr')
    renderWorkspace()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Modifier le groupe billing' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByRole('textbox', { name: 'Nom' })).toBeTruthy()
    expect(dialog.getByRole('button', { name: 'Couleur 1' })).toBeTruthy()
    expect(dialog.getByLabelText('Couleur personnalisée')).toBeTruthy()
    expect(dialog.getByRole('button', { name: 'Supprimer le groupe' })).toBeTruthy()
  })
})
