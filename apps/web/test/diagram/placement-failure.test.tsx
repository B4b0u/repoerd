// @vitest-environment jsdom
import type { DbSchema } from '@repoerd/model'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramCanvas } from '../../src/features/diagram/DiagramCanvas'
import { RelatedCanvas } from '../../src/features/diagram/RelatedCanvas'
import { RelatedTablesPreview } from '../../src/features/diagram/RelatedTablesPreview'
import { renderWithApp } from '../render'

// ELK failing (a worker crash, an unexpected graph) must not leave "Placing tables…" forever.
vi.mock('../../src/features/diagram/layout/place-tables', () => ({
  placeTables: () => Promise.reject(new Error('elk crashed')),
}))
vi.mock('../../src/features/diagram/layout/related', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/features/diagram/layout/related')>()),
  layoutRelated: () => Promise.reject(new Error('elk crashed')),
}))

const column = {
  name: 'id',
  type: 'uuid',
  notNull: true,
  default: null,
  comment: null,
  isPrimaryKey: true,
  isUnique: false,
}
const schema: DbSchema = {
  tables: {
    users: {
      name: 'users',
      schema: null,
      comment: null,
      columns: [column],
      indexes: [],
      constraints: [],
    },
    posts: {
      name: 'posts',
      schema: null,
      comment: null,
      columns: [column],
      indexes: [],
      constraints: [],
    },
  },
  enums: {},
  relationships: [
    {
      name: 'posts_users_fk',
      from: { table: 'users', columns: ['id'] },
      to: { table: 'posts', columns: ['id'] },
      cardinality: 'ONE_TO_MANY',
    },
  ],
}
const nothing = new Set<string>()
const noop = () => {}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('placement failures', () => {
  it('reports them on the full schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ positions: [] })),
    )
    renderWithApp(
      <QueryClientProvider client={new QueryClient()}>
        <ReactFlowProvider>
          <DiagramCanvas
            repo={{ owner: 'acme', name: 'shop' }}
            schema={schema}
            sourceId="prisma/schema.prisma"
            mode="ALL_FIELDS"
            onModeChange={noop}
            hidden={nothing}
            onActivate={noop}
          />
        </ReactFlowProvider>
      </QueryClientProvider>,
    )
    expect((await screen.findByRole('alert')).textContent).toContain('elk crashed')
  })

  it('reports them in the related view', async () => {
    renderWithApp(
      <ReactFlowProvider>
        <RelatedCanvas
          schema={schema}
          focus="users"
          mode="ALL_FIELDS"
          onModeChange={noop}
          hidden={nothing}
          onActivate={noop}
          onBack={noop}
        />
      </ReactFlowProvider>,
    )
    expect((await screen.findByRole('alert')).textContent).toContain('elk crashed')
  })

  it('reports them in the detail panel preview', async () => {
    renderWithApp(<RelatedTablesPreview schema={schema} table="users" onOpen={noop} />)
    expect((await screen.findByRole('alert')).textContent).toContain('elk crashed')
  })
})
