// @vitest-environment jsdom
import type { DbSchema, Table } from '@repoerd/model'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramCanvas } from '../../src/features/diagram/DiagramCanvas'
import type { GroupView } from '../../src/features/diagram/groups/group-view'
import { renderWithApp } from '../render'

const layout = vi.hoisted(() => {
  const positions = new Map([
    ['users', { x: 0, y: 0 }],
    ['posts', { x: 400, y: 0 }],
  ])
  return {
    positions,
    placeTables: vi.fn(async () => ({ positions, added: [] })),
    layoutTables: vi.fn(async () => positions),
  }
})

vi.mock('../../src/features/diagram/layout/place-tables', () => ({
  placeTables: layout.placeTables,
}))
vi.mock('../../src/features/diagram/layout/auto-layout', () => ({
  layoutTables: layout.layoutTables,
}))

const table = (name: string): Table => ({
  name,
  schema: null,
  comment: null,
  columns: [],
  indexes: [],
  constraints: [],
})
const schema: DbSchema = {
  tables: { users: table('users'), posts: table('posts') },
  enums: {},
  relationships: [],
}
const MEMBERSHIP = new Map<string, string | null>([
  ['users', 'g1'],
  ['posts', null],
])
const view = (loading: boolean): GroupView => ({
  proposed: false,
  reproposed: false,
  groups: loading ? [] : [{ id: 'g1', name: 'Core', color: '#123456', origins: [] }],
  membership: loading
    ? new Map<string, string | null>([
        ['users', null],
        ['posts', null],
      ])
    : MEMBERSHIP,
  canEdit: true,
  loading,
})
const noop = () => {}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function renderCanvas(groups: GroupView) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET'
        ? Response.json({ positions: [] })
        : new Response(null, { status: 204 }),
    ),
  )
  let setGroups: (next: GroupView) => void = noop
  function Canvas() {
    const [current, setCurrent] = useState(groups)
    setGroups = setCurrent
    return (
      <ReactFlowProvider>
        <DiagramCanvas
          repo={{ owner: 'acme', name: 'shop' }}
          schema={schema}
          sourceId="prisma/schema.prisma"
          mode="ALL_FIELDS"
          onModeChange={noop}
          hidden={new Set()}
          onActivate={noop}
          groups={current}
        />
      </ReactFlowProvider>
    )
  }
  renderWithApp(<Canvas />, new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return { rerender: (next: GroupView) => act(() => setGroups(next)) }
}

describe('DiagramCanvas with groups', () => {
  it('waits for the groups before placing the tables of a first visit', async () => {
    const { rerender } = renderCanvas(view(true))
    expect(await screen.findByText('Placing tables…')).toBeTruthy()
    // The layout has been read: only the groups hold the placement back.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(layout.placeTables).not.toHaveBeenCalled()

    rerender(view(false))
    await vi.waitFor(() => expect(layout.placeTables).toHaveBeenCalledTimes(1))
    expect(layout.placeTables).toHaveBeenCalledWith(schema, [], 'ALL_FIELDS', MEMBERSHIP)
  })

  it('places the tables without groups when the groups failed to load', async () => {
    const failed = { ...view(true), loading: false }
    renderCanvas(failed)
    await vi.waitFor(() => expect(layout.placeTables).toHaveBeenCalledTimes(1))
    expect(layout.placeTables).toHaveBeenCalledWith(schema, [], 'ALL_FIELDS', failed.membership)
  })

  it('rearranges every table group by group', async () => {
    const user = userEvent.setup()
    renderCanvas(view(false))
    await user.click(await screen.findByRole('button', { name: 'Rearrange all tables' }))
    await user.click(await screen.findByRole('button', { name: 'Rearrange' }))

    await vi.waitFor(() => expect(layout.layoutTables).toHaveBeenCalledTimes(1))
    expect(layout.layoutTables).toHaveBeenCalledWith(
      schema,
      ['users', 'posts'],
      'ALL_FIELDS',
      MEMBERSHIP,
    )
  })
})
