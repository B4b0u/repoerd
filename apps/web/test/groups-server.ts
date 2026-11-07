import type { TableGroupsResponse } from '@repoerd/contracts'
import type { TableGroup } from '@repoerd/model'
import { QueryClient } from '@tanstack/react-query'
import { vi } from 'vitest'
import { applyEdits, type GroupEdit } from '../src/features/diagram/groups/edits'

export interface SentRequest {
  method: string
  path: string
  body: unknown
}

type State = Omit<TableGroupsResponse, 'canEdit'>

/** The edit a group write stands for, from its method, path and body. */
function editOf(method: string, path: string, body: Record<string, unknown>): GroupEdit {
  const groupId = decodeURIComponent(path.match(/\/groups\/([^?]+)/)?.[1] ?? '')
  if (method === 'PATCH') {
    return {
      kind: 'place',
      assignments: body.assignments as Record<string, string | null>,
      clear: (body.clear as string[] | undefined) ?? [],
    }
  }
  if (method === 'DELETE') return { kind: 'deleteGroup', groupId }
  return { kind: 'saveGroup', group: { ...(body as Omit<TableGroup, 'id'>), id: groupId } }
}

/**
 * A server answering the group routes from `state`, which every write changes as the real one
 * would, and any other read with the saved `positions` (none by default). `sent`: the group
 * writes, in order.
 */
export function fakeGroupsServer(
  initial: State,
  {
    canEdit = true,
    positions = [],
  }: { canEdit?: boolean; positions?: { table: string; x: number; y: number }[] } = {},
) {
  const server = {
    state: initial,
    sent: [] as SentRequest[],
    client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const isGroups = /\/groups(-assignments)?[/?]/.test(String(path))
      if (method === 'GET') {
        return isGroups ? Response.json({ ...server.state, canEdit }) : Response.json({ positions })
      }
      if (!isGroups) return new Response(null, { status: 204 })
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      server.sent.push({ method, path, body })
      if (method === 'PUT' && /\/groups\?/.test(path)) {
        server.state = { configured: true, ...body }
        return Response.json({ ...server.state, canEdit })
      }
      const { canEdit: _, ...next } = applyEdits({ ...server.state, canEdit }, [
        editOf(method, path, body ?? {}),
      ])
      server.state = next
      return new Response(null, { status: 204 })
    }),
  )
  return server
}

/** "METHOD path" of each group write. */
export const writes = (server: { sent: SentRequest[] }) =>
  server.sent.map((s) => `${s.method} ${s.path}`)
