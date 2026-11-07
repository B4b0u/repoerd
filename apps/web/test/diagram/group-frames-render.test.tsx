// @vitest-environment jsdom
import type { TableGroupsResponse } from '@repoerd/contracts'
import type { DbSchema, Table } from '@repoerd/model'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramWorkspace } from '../../src/features/diagram/DiagramWorkspace'
import { FlowCanvas } from '../../src/features/diagram/FlowCanvas'
import { buildGroupView } from '../../src/features/diagram/groups/group-view'
import { buildFlow, type TableFlowNode } from '../../src/features/diagram/model/to-flow'
import type { ViewState } from '../../src/features/diagram/view-state'
import { i18n } from '../../src/shared/i18n/i18n'
import { renderWithApp } from '../render'

// vi.mock factories run before the module body: share the positions through vi.hoisted.
const { PLACED } = vi.hoisted(() => ({
  PLACED: new Map([
    ['invoices', { x: 0, y: 0 }],
    ['payments', { x: 400, y: 0 }],
    ['ledger', { x: 0, y: 300 }],
    // Far from the rest of the billing group.
    ['refunds', { x: 6000, y: 6000 }],
    ['users', { x: 1200, y: 0 }],
    ['sessions', { x: 1600, y: 0 }],
  ]),
}))

vi.mock('../../src/features/diagram/layout/place-tables', () => ({
  placeTables: async () => ({ positions: PLACED, added: [] }),
}))
vi.mock('../../src/features/diagram/layout/related', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/features/diagram/layout/related')>()),
  layoutRelated: async (schema: DbSchema) => ({ schema, positions: PLACED }),
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
const table = (name: string, file: string): Table => ({
  name,
  schema: null,
  comment: null,
  columns: [column],
  indexes: [],
  constraints: [],
  file,
})
const schema: DbSchema = {
  tables: Object.fromEntries(
    [
      table('invoices', 'db/billing.ts'),
      table('payments', 'db/billing.ts'),
      table('ledger', 'db/billing.ts'),
      table('refunds', 'db/billing.ts'),
      table('users', 'db/users.ts'),
      table('sessions', 'db/users.ts'),
    ].map((t) => [t.name, t]),
  ),
  enums: {},
  relationships: [],
}

const unconfigured: TableGroupsResponse = {
  configured: false,
  groups: [],
  assignments: {},
  canEdit: true,
}
const configured: TableGroupsResponse = {
  configured: true,
  groups: [
    {
      id: 'g-billing',
      name: 'Billing',
      color: '#1e90ff',
      origins: [{ kind: 'file', path: 'db/billing.ts' }],
    },
    {
      id: 'g-users',
      name: 'Accounts',
      color: '#e6194b',
      origins: [{ kind: 'file', path: 'db/users.ts' }],
    },
  ],
  assignments: {},
  canEdit: true,
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** `groups`: the answer of GET …/groups, or an HTTP error status. */
function renderWorkspace(groups: TableGroupsResponse | number, view: Partial<ViewState> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (String(path).includes('/groups')) {
        return typeof groups === 'number'
          ? Response.json(
              { error: { code: 'internal_error', message: 'Boom' } },
              { status: groups },
            )
          : Response.json(groups)
      }
      return Response.json({ positions: [] })
    }),
  )
  const updateView = vi.fn()
  const result = renderWithApp(
    <DiagramWorkspace
      repo={{ owner: 'acme', name: 'shop' }}
      schema={schema}
      sourceId="drizzle.config.ts"
      viewState={{ hidden: [], mode: 'ALL_FIELDS', ...view }}
      updateView={updateView}
    />,
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return { ...result, updateView }
}

const frames = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>('.group-frame'),
]
const labels = (container: HTMLElement) =>
  frames(container).map((f) => f.querySelector('.group-frame__label')?.textContent)

describe('group frames on the diagram', () => {
  it('draws dashed frames and a banner for proposed groups', async () => {
    await i18n.changeLanguage('fr')
    const { container } = renderWorkspace(unconfigured)
    const banner = await screen.findByText("2 groupes proposés d'après les fichiers du schéma")
    expect(banner.closest('[role="status"]')).toBeTruthy()
    await vi.waitFor(() => expect(frames(container)).toHaveLength(2))
    expect(labels(container).sort()).toEqual(['billing', 'users'])
    for (const frame of frames(container)) {
      expect(frame.classList).toContain('group-frame--proposed')
      expect(frame.dataset.groupId).toMatch(/^p/)
    }
  })

  it('draws solid frames without a banner for saved groups', async () => {
    const { container } = renderWorkspace(configured)
    await vi.waitFor(() => expect(frames(container)).toHaveLength(2))
    expect(labels(container).sort()).toEqual(['Accounts', 'Billing'])
    for (const frame of frames(container)) {
      expect(frame.classList).not.toContain('group-frame--proposed')
    }
    expect(screen.queryByText(/groups proposed/)).toBeNull()
  })

  it('tags a table far from its group with the group name', async () => {
    const { container } = renderWorkspace(configured)
    await vi.waitFor(() => expect(container.querySelector('.table-node__group-tag')).toBeTruthy())
    const tags = [...container.querySelectorAll('.table-node__group-tag')]
    expect(tags).toHaveLength(1)
    expect(tags[0]?.textContent).toBe('Billing')
    expect(tags[0]?.closest('.table-node')?.querySelector('.table-node__title')?.textContent).toBe(
      'refunds',
    )
    // The far table stays out of the frame: billing's frame spans invoices, payments and ledger.
    const billing = container.querySelector<HTMLElement>('[data-group-id="g-billing"]')
    expect(Number.parseFloat(billing?.style.width ?? '')).toBeLessThan(1000)
  })

  it('activates no table when a frame or its label is clicked', async () => {
    const { container, updateView } = renderWorkspace(configured)
    await vi.waitFor(() => expect(frames(container)).toHaveLength(2))
    const frame = frames(container)[0] as HTMLElement
    // A click only: a mouse down reaches d3-zoom (the canvas pans from a label), which jsdom
    // cannot run.
    fireEvent.click(frame.querySelector('.group-frame__label') as HTMLElement)
    fireEvent.click(frame)
    expect(updateView).not.toHaveBeenCalledWith(
      expect.objectContaining({ active: expect.any(String) }),
    )
  })

  it('draws no frame in the related-tables view, and names the group on every grouped card', async () => {
    const { container } = renderWorkspace(configured, { focus: 'invoices' })
    await vi.waitFor(() => expect(container.querySelector('.table-node')).toBeTruthy())
    await vi.waitFor(() => expect(container.querySelector('.table-node--grouped')).toBeTruthy())
    expect(frames(container)).toHaveLength(0)
    const invoices = [...container.querySelectorAll('.table-node')].find(
      (card) => card.querySelector('.table-node__title')?.textContent === 'invoices',
    )
    expect(invoices?.querySelector('.table-node__group-tag')?.textContent).toBe('Billing')
    const cards = container.querySelectorAll('.table-node--grouped')
    expect(container.querySelectorAll('.table-node__group-tag')).toHaveLength(cards.length)
  })

  it('shows the diagram without groups when they cannot be loaded', async () => {
    const { container } = renderWorkspace(500)
    await vi.waitFor(() => expect(container.querySelector('.table-node')).toBeTruthy())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(frames(container)).toHaveLength(0)
    expect(container.querySelector('.table-node--grouped')).toBeNull()
    expect(screen.queryByText(/groups proposed/)).toBeNull()
  })
})

describe('group frames during a drag', () => {
  const view = buildGroupView(schema, configured)
  const base = buildFlow(schema, PLACED).nodes
  const moved = (dragging: boolean): TableFlowNode[] =>
    base.map((n) => (n.id === 'payments' ? { ...n, position: { x: 8000, y: 8000 }, dragging } : n))
  // Hidden tables do not count: billing is invoices, payments and ledger, all close.
  const hidden = new Set(['refunds'])
  const canvas = (nodes: TableFlowNode[]) => (
    <FlowCanvas
      nodes={nodes}
      edges={[]}
      onNodesChange={() => {}}
      hidden={hidden}
      onActivate={() => {}}
      mode="ALL_FIELDS"
      onModeChange={() => {}}
      groups={view}
    />
  )
  const billingWidth = (container: HTMLElement) =>
    Number.parseFloat(
      container.querySelector<HTMLElement>('[data-group-id="g-billing"]')?.style.width ?? '',
    )

  it('follows the dragged table, and reclassifies it only once dropped', async () => {
    const { container, rerender } = render(canvas(base))
    await vi.waitFor(() => expect(billingWidth(container)).toBeLessThan(1000))

    // While dragged, the table stays a member: the frame stretches to it.
    rerender(canvas(moved(true)))
    expect(billingWidth(container)).toBeGreaterThan(8000)
    expect(container.querySelectorAll('.table-node__group-tag')).toHaveLength(0)

    // Dropped far away: it leaves the frame.
    rerender(canvas(moved(false)))
    expect(billingWidth(container)).toBeLessThan(1000)
    expect(container.querySelectorAll('.table-node__group-tag')).toHaveLength(1)
  })
})
