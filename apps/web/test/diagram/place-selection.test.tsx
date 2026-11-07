// @vitest-environment jsdom
import type { TableGroupsResponse } from '@repoerd/contracts'
import { type DbSchema, GROUP_PALETTE, type Table } from '@repoerd/model'
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
  assignments: {},
}

const repo = { owner: 'acme', name: 'shop' }
const ASSIGNMENTS = '/api/repos/acme/shop/groups-assignments?source=db'

function renderWorkspace({ canEdit = true } = {}) {
  const server = fakeGroupsServer(configured, { canEdit })
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

/** The card of a table on the canvas, once placed. */
async function card(name: string): Promise<HTMLElement> {
  return waitFor(() => {
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${name}"]`)
    if (!node) throw new Error(`no card for ${name}`)
    return node
  })
}

/** Waits for the groups (their frames' labels): the editing commands depend on them. */
const groupsLoaded = () => screen.findByRole('button', { name: 'Edit the group billing' })

/**
 * A mouse event with its view: d3-drag (the cards' drag) reads it, and neither user-event nor
 * jsdom's constructor provide one that it accepts. jsdom has no PointerEvent either: a pointer
 * event is a mouse event with the pointer fields React Flow reads.
 */
function mouse(target: Element | Window, type: string, init: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  Object.defineProperty(event, 'view', { value: window })
  if (type.startsWith('pointer')) {
    Object.defineProperties(event, { isPrimary: { value: true }, pointerId: { value: 1 } })
  }
  fireEvent(target, event)
}

/**
 * A click on a card as a browser sends it, Shift held as React Flow sees it (on the document):
 * with Shift, the press starts a selection box, which must not swallow the click.
 */
async function clickCard(name: string, { shift = false } = {}) {
  const node = await card(name)
  if (shift) fireEvent.keyDown(document, { key: 'Shift', shiftKey: true })
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    mouse(node, type, { shiftKey: shift })
  }
  if (shift) fireEvent.keyUp(document, { key: 'Shift' })
}

async function shiftClick(...tables: string[]) {
  for (const name of tables) await clickCard(name, { shift: true })
}

/** The empty canvas, where a Shift+drag draws a selection box. */
const pane = () => document.querySelector('.react-flow__pane') as HTMLElement

const shiftDown = () => fireEvent.keyDown(document, { key: 'Shift', shiftKey: true })
const shiftUp = () => fireEvent.keyUp(document, { key: 'Shift' })

/** The layout saves sent so far (the positions of moved tables). */
const layoutSaves = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(
      ([path, init]) => String(path).includes('/layout') && init?.method === 'PATCH',
    )

const activeCalls = (updateView: ReturnType<typeof vi.fn>) =>
  updateView.mock.calls.filter(([patch]) => Object.hasOwn(patch as object, 'active'))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('placing selected tables into a group', () => {
  it('selects cards with Shift+click without activating them', async () => {
    const { updateView } = renderWorkspace()
    await groupsLoaded()
    await shiftClick('users', 'invoices')

    const bar = await screen.findByRole('toolbar', { name: 'Selected tables' })
    expect(within(bar).getByText('2 tables selected')).toBeTruthy()
    expect((await card('users')).classList).toContain('selected')
    // The card shows it with a ring of its own.
    expect((await card('users')).querySelector('.table-node--selected')).toBeTruthy()
    expect(activeCalls(updateView)).toEqual([])

    // Shift+click again takes a card out of the selection.
    await shiftClick('users')
    expect(within(bar).getByText('1 table selected')).toBeTruthy()
    expect((await card('users')).classList).not.toContain('selected')
  })

  it('places every selected table with one request, then clears the selection with an undo', async () => {
    const { server } = renderWorkspace()
    await groupsLoaded()
    const user = userEvent.setup()
    await shiftClick('users', 'invoices')
    const bar = await screen.findByRole('toolbar', { name: 'Selected tables' })
    await user.click(within(bar).getByRole('button', { name: 'Accounts' }))

    await waitFor(() => expect(server.sent).toHaveLength(1))
    expect(server.sent[0]).toEqual({
      method: 'PATCH',
      path: ASSIGNMENTS,
      body: { assignments: { users: 'accounts', invoices: 'accounts' }, clear: [] },
    })
    // Placed: the tables leave the selection.
    await waitFor(() =>
      expect(screen.queryByRole('toolbar', { name: 'Selected tables' })).toBeNull(),
    )
    expect((await card('users')).classList).not.toContain('selected')
    expect(await screen.findByText('2 tables placed in "Accounts".')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(server.sent).toHaveLength(2))
    const undo = server.sent[1]?.body as { assignments: object; clear: string[] }
    expect(undo.assignments).toEqual({})
    expect([...undo.clear].sort()).toEqual(['invoices', 'users'])
  })

  it('places the selection once on a double click', async () => {
    const { server } = renderWorkspace()
    await groupsLoaded()
    await shiftClick('users', 'invoices')
    const bar = await screen.findByRole('toolbar', { name: 'Selected tables' })
    const accounts = within(bar).getByRole('button', { name: 'Accounts' })
    fireEvent.click(accounts)
    fireEvent.click(accounts)

    await waitFor(() =>
      expect(screen.queryByRole('toolbar', { name: 'Selected tables' })).toBeNull(),
    )
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(server.sent).toHaveLength(1)
  })

  it('takes the selected tables out of any group', async () => {
    const { server } = renderWorkspace()
    await groupsLoaded()
    const user = userEvent.setup()
    await shiftClick('users', 'invoices')
    const bar = await screen.findByRole('toolbar', { name: 'Selected tables' })
    await user.click(within(bar).getByRole('button', { name: 'Ungrouped' }))

    await waitFor(() => expect(server.sent).toHaveLength(1))
    expect(server.sent[0]?.body).toEqual({
      assignments: { users: null, invoices: null },
      clear: [],
    })
    expect(await screen.findByText('2 tables taken out of their group.')).toBeTruthy()
  })

  it('creates a group and places the selection in it as one gesture', async () => {
    const { server } = renderWorkspace()
    await groupsLoaded()
    const user = userEvent.setup()
    await shiftClick('users', 'invoices')
    const bar = await screen.findByRole('toolbar', { name: 'Selected tables' })
    await user.click(within(bar).getByRole('button', { name: 'New group…' }))
    const name = within(bar).getByRole('textbox', { name: 'Name of the new group' })
    expect(document.activeElement).toBe(name)
    expect(name.getAttribute('maxlength')).toBe('80')
    await user.type(name, '  Core {Enter}')

    await waitFor(() => expect(server.sent).toHaveLength(2))
    expect(writes(server)).toEqual([
      expect.stringMatching(/^PUT \/api\/repos\/acme\/shop\/groups\/[0-9a-f]+\?source=db$/),
      `PATCH ${ASSIGNMENTS}`,
    ])
    const id = server.state.groups.find((g) => g.name === 'Core')?.id
    expect(server.sent[1]?.body).toEqual({
      assignments: { users: id, invoices: id },
      clear: [],
    })
    await waitFor(() =>
      expect(screen.queryByRole('toolbar', { name: 'Selected tables' })).toBeNull(),
    )
    expect(await screen.findByText('2 tables placed in "Core".')).toBeTruthy()
    // One gesture: a single notice, a single undo.
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1)
  })

  it('cancels the new group name with Escape, keeping the selection', async () => {
    renderWorkspace()
    await groupsLoaded()
    const user = userEvent.setup()
    await shiftClick('users')
    const bar = await screen.findByRole('toolbar', { name: 'Selected tables' })
    await user.click(within(bar).getByRole('button', { name: 'New group…' }))
    await user.keyboard('{Escape}')
    expect(within(bar).queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('toolbar', { name: 'Selected tables' })).toBeTruthy()
    expect(document.activeElement).toBe(within(bar).getByRole('button', { name: 'New group…' }))
  })

  it('clears the selection with Escape', async () => {
    renderWorkspace()
    await groupsLoaded()
    const user = userEvent.setup()
    await shiftClick('users', 'invoices')
    await screen.findByRole('toolbar', { name: 'Selected tables' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('toolbar', { name: 'Selected tables' })).toBeNull()
    expect((await card('users')).classList).not.toContain('selected')
  })

  it('keeps a plain click as it was: the table becomes active, nothing is selected', async () => {
    const { updateView } = renderWorkspace()
    await groupsLoaded()
    await clickCard('users')
    expect(updateView).toHaveBeenCalledWith({ active: 'users' })
    expect((await card('users')).classList).not.toContain('selected')
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('selects nothing without the right to edit the groups', async () => {
    const { updateView } = renderWorkspace({ canEdit: false })
    // The groups are loaded once their frames are labelled.
    await waitFor(() => expect(document.querySelector('.group-frame__label')).toBeTruthy())
    await shiftClick('users', 'invoices')
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect((await card('users')).classList).not.toContain('selected')
    // Shift+click activates the table, as before.
    expect(updateView).toHaveBeenCalledWith({ active: 'users' })
  })

  it('shows the bar in French with plurals', async () => {
    renderWorkspace()
    await groupsLoaded()
    await act(() => i18n.changeLanguage('fr'))
    await shiftClick('users')
    const bar = await screen.findByRole('toolbar', { name: 'Tables sélectionnées' })
    expect(within(bar).getByText('1 table sélectionnée')).toBeTruthy()
    expect(within(bar).getByText('Ranger dans…')).toBeTruthy()
    expect(within(bar).getByRole('button', { name: 'Hors groupe' })).toBeTruthy()
    await shiftClick('invoices')
    expect(within(bar).getByText('2 tables sélectionnées')).toBeTruthy()
  })

  it('saves the position of every selected table dragged together', async () => {
    const { server } = renderWorkspace()
    await groupsLoaded()
    await shiftClick('users', 'invoices')
    await screen.findByRole('toolbar', { name: 'Selected tables' })

    const users = await card('users')
    // The drag starts on the first move past the threshold, and moves the cards from there.
    mouse(users, 'mousedown', { clientX: 10, clientY: 10 })
    mouse(window, 'mousemove', { clientX: 30, clientY: 20 })
    mouse(window, 'mousemove', { clientX: 60, clientY: 40 })
    mouse(window, 'mouseup', { clientX: 60, clientY: 40 })

    await waitFor(() => expect(layoutSaves()).toHaveLength(1), { timeout: 3000 })
    const body = JSON.parse(String(layoutSaves()[0]?.[1]?.body)) as {
      positions: { table: string; x: number; y: number }[]
    }
    expect(body.positions).toEqual(
      expect.arrayContaining([
        { table: 'users', x: 1230, y: 20 },
        { table: 'invoices', x: 30, y: 20 },
      ]),
    )
    expect(body.positions).toHaveLength(2)
    expect(server.sent).toEqual([])
  })

  it('empties the selection when another card is dragged, and saves only that one', async () => {
    renderWorkspace()
    await groupsLoaded()
    await shiftClick('users', 'invoices')
    await screen.findByRole('toolbar', { name: 'Selected tables' })

    const sessions = await card('sessions')
    mouse(sessions, 'mousedown', { clientX: 10, clientY: 10 })
    mouse(window, 'mousemove', { clientX: 30, clientY: 20 })
    mouse(window, 'mousemove', { clientX: 60, clientY: 40 })
    mouse(window, 'mouseup', { clientX: 60, clientY: 40 })

    await waitFor(() =>
      expect(screen.queryByRole('toolbar', { name: 'Selected tables' })).toBeNull(),
    )
    await waitFor(() => expect(layoutSaves()).toHaveLength(1), { timeout: 3000 })
    expect(JSON.parse(String(layoutSaves()[0]?.[1]?.body))).toEqual({
      positions: [{ table: 'sessions', x: 1630, y: 20 }],
    })
  })

  it('does not stay in selection mode when Shift is let go before the button', async () => {
    const { updateView } = renderWorkspace()
    await groupsLoaded()
    // On the empty canvas: the press would start a selection box.
    shiftDown()
    mouse(pane(), 'pointerdown', { shiftKey: true, clientX: 5, clientY: 5 })
    shiftUp()
    mouse(pane(), 'pointerup', { clientX: 5, clientY: 5 })
    mouse(pane(), 'click', { clientX: 5, clientY: 5 })
    // On a card.
    const sessions = await card('sessions')
    shiftDown()
    mouse(sessions, 'pointerdown', { shiftKey: true })
    mouse(sessions, 'mousedown', { shiftKey: true })
    shiftUp()
    for (const type of ['pointerup', 'mouseup', 'click']) mouse(sessions, type)

    await clickCard('users')
    expect(updateView).toHaveBeenCalledWith({ active: 'users' })
    expect((await card('users')).classList).not.toContain('selected')
    expect(screen.queryByRole('toolbar')).toBeNull()
    // Shift alone, the button up: moving the mouse draws no box.
    shiftDown()
    mouse(pane(), 'pointermove', { shiftKey: true, clientX: 80, clientY: 80 })
    shiftUp()
    expect(document.querySelector('.react-flow__selection')).toBeNull()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('selects with a Shift+drag box and leaves the cards clickable afterwards', async () => {
    const { updateView } = renderWorkspace()
    await groupsLoaded()
    shiftDown()
    mouse(pane(), 'pointerdown', { shiftKey: true, clientX: 0, clientY: 0 })
    mouse(pane(), 'pointermove', { shiftKey: true, clientX: 40, clientY: 40 })
    mouse(pane(), 'pointermove', { shiftKey: true, clientX: 80, clientY: 80 })
    mouse(pane(), 'pointerup', { shiftKey: true, clientX: 80, clientY: 80 })
    mouse(pane(), 'click', { shiftKey: true, clientX: 80, clientY: 80 })
    shiftUp()

    // jsdom measures nothing: every card counts as inside the box.
    const bar = await screen.findByRole('toolbar', { name: 'Selected tables' })
    expect(within(bar).getByText('4 tables selected')).toBeTruthy()
    expect(activeCalls(updateView)).toEqual([])
    // No overlay over the selected cards (it would catch their clicks and move them unsaved).
    expect(document.querySelector('.react-flow__nodesselection')).toBeNull()
    await clickCard('users')
    expect(updateView).toHaveBeenCalledWith({ active: 'users' })
  })

  it('toggles a card on a Shift+click that moves a little, keeping the others selected', async () => {
    renderWorkspace()
    await groupsLoaded()
    await shiftClick('invoices')
    const users = await card('users')
    shiftDown()
    mouse(users, 'pointerdown', { shiftKey: true, clientX: 10, clientY: 10 })
    mouse(users, 'mousedown', { shiftKey: true, clientX: 10, clientY: 10 })
    mouse(users, 'pointermove', { shiftKey: true, clientX: 11, clientY: 10 })
    mouse(users, 'pointerup', { shiftKey: true, clientX: 11, clientY: 10 })
    mouse(users, 'mouseup', { shiftKey: true, clientX: 11, clientY: 10 })
    mouse(users, 'click', { shiftKey: true, clientX: 11, clientY: 10 })
    shiftUp()

    const bar = await screen.findByRole('toolbar', { name: 'Selected tables' })
    expect(within(bar).getByText('2 tables selected')).toBeTruthy()
    expect((await card('invoices')).classList).toContain('selected')
    expect((await card('users')).classList).toContain('selected')
  })

  it('keeps the selection when the placement is refused', async () => {
    renderWorkspace()
    await groupsLoaded()
    const answer = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation(async (path, init) =>
      init?.method === 'PATCH' && String(path).includes('groups-assignments')
        ? Response.json({ error: { code: 'internal_error', message: 'Boom' } }, { status: 500 })
        : (answer as typeof fetch)(path, init),
    )
    const user = userEvent.setup()
    await shiftClick('users', 'invoices')
    const bar = await screen.findByRole('toolbar', { name: 'Selected tables' })
    await user.click(within(bar).getByRole('button', { name: 'Accounts' }))

    await waitFor(() => expect(screen.getByText(/Boom|went wrong|error/i)).toBeTruthy())
    expect(within(bar).getByText('2 tables selected')).toBeTruthy()
    expect((await card('users')).classList).toContain('selected')
  })

  it('announces the count from a live region there before anything is selected', async () => {
    renderWorkspace()
    await groupsLoaded()
    const status = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-selection-status]')
      if (!found) throw new Error('no selection status')
      return found
    })
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toBe('')
    await shiftClick('users', 'invoices')
    expect(status.textContent).toBe('2 tables selected')
  })
})
