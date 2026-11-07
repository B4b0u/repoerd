// @vitest-environment jsdom
import type { TableGroupsResponse } from '@repoerd/contracts'
import { type DbSchema, proposeGroups, type Table, type TableGroup } from '@repoerd/model'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupsKey, useTableGroups } from '../../src/features/diagram/groups/api'
import { buildGroupView } from '../../src/features/diagram/groups/group-view'
import { useGroupEdits } from '../../src/features/diagram/groups/use-group-edits'
import { renderWithApp } from '../render'

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

const billing: TableGroup = {
  id: 'billing',
  name: 'billing',
  color: '#e6194b',
  origins: [{ kind: 'file', path: 'db/post.ts' }],
}

interface Sent {
  method: string
  path: string
  body: unknown
}

/** A server answering the group routes from `state`; `refuse` answers the next write with an error. */
function fakeServer(initial: Omit<TableGroupsResponse, 'canEdit'>) {
  const server = {
    state: initial,
    sent: [] as Sent[],
    refuse: undefined as { status: number; body: unknown } | undefined,
    /** Cache of the client seen by each write, when it arrived. */
    seen: [] as unknown[],
    client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET') return Response.json({ ...server.state, canEdit: true })
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      server.sent.push({ method, path, body })
      server.seen.push(server.client.getQueryData(groupsKey(repo, source)))
      const refusal = server.refuse
      if (refusal) {
        server.refuse = undefined
        return Response.json(refusal.body, { status: refusal.status })
      }
      if (method === 'PUT' && path.startsWith('/api/repos/acme/shop/groups?')) {
        server.state = { configured: true, ...body }
        return Response.json({ ...server.state, canEdit: true })
      }
      server.state = { ...server.state, configured: true }
      return new Response(null, { status: 204 })
    }),
  )
  return server
}

type Edits = ReturnType<typeof useGroupEdits>

function Probe({ out }: { out: { edits?: Edits } }) {
  const groups = useTableGroups(repo, source)
  const view = buildGroupView(schema, groups.data)
  out.edits = useGroupEdits(repo, source, schema, view)
  return groups.data ? <p>loaded</p> : null
}

async function mount(server: ReturnType<typeof fakeServer>) {
  const out: { edits?: Edits } = {}
  renderWithApp(<Probe out={out} />, server.client)
  await screen.findByText('loaded')
  return () => out.edits as Edits
}

const writes = (server: { sent: Sent[] }) => server.sent.map((s) => `${s.method} ${s.path}`)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useGroupEdits', () => {
  it('saves the proposals once before the first gestures, even two at once', async () => {
    const server = fakeServer({ configured: false, groups: [], assignments: {} })
    const edits = await mount(server)
    const proposals = proposeGroups(schema)
    const target = proposals[0]?.id as string

    await act(async () => {
      await Promise.all([
        edits().run([{ kind: 'place', assignments: { user: target }, clear: [] }]),
        edits().place(['post'], null),
      ])
    })

    expect(writes(server)).toEqual([
      'PUT /api/repos/acme/shop/groups?source=db',
      'PATCH /api/repos/acme/shop/groups-assignments?source=db',
      'PATCH /api/repos/acme/shop/groups-assignments?source=db',
    ])
    expect(server.sent[0]?.body).toEqual({ groups: proposals, assignments: {} })
    // Optimistic: the cache already held the gesture when the first request left.
    expect(server.seen[0]).toMatchObject({
      configured: true,
      groups: proposals,
      assignments: { user: target },
    })
    expect(edits().pending).toBe(false)
  })

  it('restores the cache and says why when the server refuses', async () => {
    const server = fakeServer({ configured: true, groups: [billing], assignments: {} })
    const edits = await mount(server)
    const before = server.client.getQueryData(groupsKey(repo, source))
    server.refuse = {
      status: 400,
      body: {
        error: {
          code: 'bad_request',
          message: 'At most 100 groups per source',
          details: { reason: 'invalid-groups', problem: 'too-many-groups' },
        },
      },
    }
    const created = { id: 'new1', name: 'new', color: '#1e90ff', origins: [] }

    await act(async () => {
      await edits().run([{ kind: 'saveGroup', group: created }], { undoLabel: 'Group created' })
    })

    expect(server.seen[0]).toMatchObject({ groups: [billing, created] })
    expect(await screen.findByText('At most 100 groups per schema source.')).toBeTruthy()
    expect(screen.queryByText('Group created')).toBeNull()
    expect(server.client.getQueryData(groupsKey(repo, source))).toEqual(before)
  })

  it('explains a refused source in both cases of invalid-groups-target', async () => {
    const server = fakeServer({ configured: true, groups: [billing], assignments: {} })
    const edits = await mount(server)
    server.refuse = {
      status: 400,
      body: {
        error: {
          code: 'bad_request',
          message: 'At most 50 configured sources per repository',
          details: { reason: 'invalid-groups-target', problem: 'too-many-sources' },
        },
      },
    }

    await act(async () => {
      await edits().run([{ kind: 'saveGroup', group: { ...billing, name: 'Billing' } }])
    })

    expect(
      await screen.findByText(
        'This repository already has groups for 50 schema sources, the maximum.',
      ),
    ).toBeTruthy()
  })

  it('offers to undo a gesture, which sends its inverse', async () => {
    const server = fakeServer({
      configured: true,
      groups: [billing],
      assignments: { user: 'billing' },
    })
    const edits = await mount(server)

    await act(async () => {
      await edits().run([{ kind: 'deleteGroup', groupId: 'billing' }], {
        undoLabel: 'Group deleted',
      })
    })
    expect(await screen.findByText('Group deleted')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(server.sent).toHaveLength(3))
    expect(server.sent.map((s) => [s.method, s.path, s.body])).toEqual([
      ['DELETE', '/api/repos/acme/shop/groups/billing?source=db', undefined],
      [
        'PUT',
        '/api/repos/acme/shop/groups/billing?source=db',
        { name: 'billing', color: '#e6194b', origins: billing.origins },
      ],
      [
        'PATCH',
        '/api/repos/acme/shop/groups-assignments?source=db',
        { assignments: { user: 'billing' }, clear: [] },
      ],
    ])
  })

  it('leaves a signed-out session to the usual handling, without an error notice', async () => {
    const server = fakeServer({ configured: true, groups: [billing], assignments: {} })
    const edits = await mount(server)
    server.refuse = {
      status: 401,
      body: { error: { code: 'unauthenticated', message: 'Sign in' } },
    }
    const invalidate = vi.spyOn(server.client, 'invalidateQueries')

    await act(async () => {
      await edits().run([{ kind: 'deleteGroup', groupId: 'billing' }])
    })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] })
    expect(screen.queryByText('Sign in to continue.')).toBeNull()
  })
})
