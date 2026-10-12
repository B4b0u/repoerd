// @vitest-environment jsdom
import type { DbSchema } from '@repoerd/model'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramCanvas } from '../../src/features/diagram/DiagramCanvas'
import { renderWithApp } from '../render'

const { PLACED } = vi.hoisted(() => ({ PLACED: new Map([['users', { x: 0, y: 0 }]]) }))
vi.mock('../../src/features/diagram/layout/place-tables', () => ({
  placeTables: async () => ({ positions: PLACED, added: [{ table: 'users', x: 0, y: 0 }] }),
}))

const schema: DbSchema = {
  tables: {
    users: {
      name: 'users',
      schema: null,
      comment: null,
      columns: [],
      indexes: [],
      constraints: [],
    },
  },
  enums: {},
  relationships: [],
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DiagramCanvas under StrictMode', () => {
  it('still retries a failed save automatically (the effect cleanup ran once already)', async () => {
    const methods: string[] = []
    const saves = [500]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        methods.push(method)
        if (method === 'GET') return Response.json({ positions: [] })
        return saves.shift() === 500
          ? Response.json({ error: { code: 'internal_error', message: 'Boom' } }, { status: 500 })
          : new Response(null, { status: 204 })
      }),
    )
    renderWithApp(
      <ReactFlowProvider>
        <DiagramCanvas
          repo={{ owner: 'acme', name: 'shop' }}
          schema={schema}
          sourceId="prisma/schema.prisma"
          mode="ALL_FIELDS"
          onModeChange={() => {}}
          hidden={new Set()}
          onActivate={() => {}}
        />
      </ReactFlowProvider>,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      { reactStrictMode: true },
    )
    expect(await screen.findByText('Layout changes could not be saved.')).toBeTruthy()
    await vi.waitFor(() => expect(methods.filter((m) => m === 'PATCH').length).toBeGreaterThan(1), {
      timeout: 3000,
    })
  })
})
