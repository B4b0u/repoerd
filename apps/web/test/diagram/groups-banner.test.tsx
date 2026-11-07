// @vitest-environment jsdom
import type { TableGroupsResponse } from '@repoerd/contracts'
import { type DbSchema, proposeGroups, type Table, type TableGroup } from '@repoerd/model'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramWorkspace } from '../../src/features/diagram/DiagramWorkspace'
import { groupsKey } from '../../src/features/diagram/groups/api'
import { parseViewState } from '../../src/features/diagram/view-state'
import { renderWithApp } from '../render'

const layout = vi.hoisted(() => {
  const positions = new Map([
    ['user', { x: 0, y: 0 }],
    ['post', { x: 400, y: 0 }],
  ])
  return {
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

const repo = { owner: 'acme', name: 'shop' }
const source = 'db'
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
  tables: { user: table('user', 'db/user.ts'), post: table('post', 'db/post.ts') },
  enums: {},
  relationships: [],
}
const mine: TableGroup = {
  id: 'mine',
  name: 'Mine',
  color: '#123456',
  origins: [{ kind: 'file', path: 'db/user.ts' }],
}
const saved: Omit<TableGroupsResponse, 'canEdit'> = {
  configured: true,
  groups: [mine],
  assignments: {},
}
const unconfigured: Omit<TableGroupsResponse, 'canEdit'> = {
  configured: false,
  groups: [],
  assignments: {},
}

interface Sent {
  method: string
  path: string
  body: unknown
}

function mount(initial: Omit<TableGroupsResponse, 'canEdit'>, canEdit = true) {
  let state = initial
  const sent: Sent[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (path.includes('/groups')) {
        if (method === 'GET') return Response.json({ ...state, canEdit })
        const body = init?.body ? JSON.parse(init.body as string) : undefined
        sent.push({ method, path, body })
        if (method === 'PUT' && path.includes('/groups?')) state = { configured: true, ...body }
        return new Response(null, { status: 204 })
      }
      return method === 'GET'
        ? Response.json({ positions: [] })
        : new Response(null, { status: 204 })
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const control = { setSource: (_id: string) => {} }
  function Workspace() {
    const [sourceId, setSourceId] = useState(source)
    control.setSource = setSourceId
    return (
      <DiagramWorkspace
        repo={repo}
        schema={schema}
        sourceId={sourceId}
        viewState={parseViewState('')}
        updateView={() => {}}
      />
    )
  }
  renderWithApp(<Workspace />, client)
  return { sent, client, control }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const SAVE = 'Save for the team'
const IGNORE = 'Ignore for the team'
const REPROPOSE = 'Propose again from the files'
const REPLACE = 'Replace for the team'

describe('proposal banner', () => {
  it('saves the proposals for the team', async () => {
    const user = userEvent.setup()
    const { sent } = mount(unconfigured)
    await user.click(await screen.findByRole('button', { name: SAVE }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.method).toBe('PUT')
    expect(sent[0]?.path).toContain('/groups?')
    expect(sent[0]?.body).toEqual({ groups: proposeGroups(schema), assignments: {} })
  })

  it('ignores the proposals for the team: saves an empty set', async () => {
    const user = userEvent.setup()
    const { sent } = mount(unconfigured)
    await user.click(await screen.findByRole('button', { name: IGNORE }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.body).toEqual({ groups: [], assignments: {} })
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('offers no button without the push right', async () => {
    mount(unconfigured, false)
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull()
    expect(screen.queryByRole('button', { name: IGNORE })).toBeNull()
    expect(screen.queryByRole('button', { name: REPROPOSE })).toBeNull()
  })
})

describe('propose again', () => {
  it('is offered with the push right on a configured source only', async () => {
    mount(saved)
    expect(await screen.findByRole('button', { name: REPROPOSE })).toBeTruthy()
    cleanup()
    mount(saved, false)
    await screen.findByRole('button', { name: 'Zoom in' })
    expect(screen.queryByRole('button', { name: REPROPOSE })).toBeNull()
    cleanup()
    mount(unconfigured)
    await screen.findByRole('button', { name: SAVE })
    expect(screen.queryByRole('button', { name: REPROPOSE })).toBeNull()
  })

  it('shows the proposals locally, and cancelling sends nothing', async () => {
    const user = userEvent.setup()
    const { sent } = mount(saved)
    await user.click(await screen.findByRole('button', { name: REPROPOSE }))
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByRole('button', { name: REPLACE })).toBeTruthy()
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull()
    expect(screen.queryByRole('button', { name: REPROPOSE })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(sent).toEqual([])
  })

  it('replaces the saved groups for the team, with an undo that restores them', async () => {
    const user = userEvent.setup()
    const { sent, client } = mount(saved)
    await user.click(await screen.findByRole('button', { name: REPROPOSE }))
    await user.click(await screen.findByRole('button', { name: REPLACE }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.body).toEqual({ groups: proposeGroups(schema), assignments: {} })
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())

    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1]?.body).toEqual({ groups: [mine], assignments: {} })
    expect(client.getQueryData(groupsKey(repo, source))).toBeDefined()
  })

  it('goes back to the saved groups when the source changes', async () => {
    const user = userEvent.setup()
    const { control } = mount(saved)
    await user.click(await screen.findByRole('button', { name: REPROPOSE }))
    await screen.findByRole('status')
    await act(async () => {
      control.setSource('other')
    })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
