// @vitest-environment jsdom
import type { Table } from '@repoerd/model'
import { cleanup, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { NodeDiff } from '../../src/features/diagram/model/diff-view'
import { TableNode } from '../../src/features/diagram/TableNode'

afterEach(cleanup)

const col = (name: string) => ({
  name,
  type: 'text',
  notNull: false,
  default: null,
  comment: null,
  isPrimaryKey: false,
  isUnique: false,
})
const table: Table = {
  name: 'order_items',
  schema: null,
  comment: null,
  columns: [col('id'), col('sku')],
  indexes: [],
  constraints: [],
}

describe('TableNode overview name', () => {
  it('keeps every column row and adds an aria-hidden overview name', () => {
    const props = {
      id: 'order_items',
      data: {
        table,
        columns: table.columns,
        foreignKeyColumns: [],
        mode: 'ALL_FIELDS',
        highlight: 'normal',
      },
    } as unknown as Parameters<typeof TableNode>[0]
    const { container } = render(
      <ReactFlowProvider>
        <TableNode {...props} />
      </ReactFlowProvider>,
    )
    expect(container.querySelectorAll('.table-node__column')).toHaveLength(2)
    const name = container.querySelector('.table-node__overview-name')
    expect(name?.textContent).toBe('order_items')
    expect(name?.getAttribute('aria-hidden')).toBe('true')
    const root = container.querySelector<HTMLElement>('.table-node')
    expect(root?.style.getPropertyValue('--name-length')).toBe(String('order_items'.length))
  })
})

describe('TableNode in a comparison', () => {
  const columns = [col('id'), col('sku'), col('qty'), col('old')]
  const compared: Table = { ...table, columns }
  const renderNode = (diff: NodeDiff) => {
    const props = {
      id: 'order_items',
      data: {
        table: compared,
        columns,
        foreignKeyColumns: [],
        mode: 'ALL_FIELDS',
        highlight: 'none',
        diff,
      },
    } as unknown as Parameters<typeof TableNode>[0]
    return render(
      <ReactFlowProvider>
        <TableNode {...props} />
      </ReactFlowProvider>,
    ).container
  }

  it('marks each changed column with a symbol, and writes a type change in the row', () => {
    const container = renderNode({
      status: 'modified',
      counts: { added: 1, modified: 1, removed: 1 },
      columns: {
        id: { name: 'id', status: 'unchanged', changes: [] },
        sku: {
          name: 'sku',
          status: 'modified',
          changes: [
            { field: 'type', before: 'text', after: 'varchar(20)' },
            { field: 'notNull', before: false, after: true },
          ],
        },
        qty: { name: 'qty', status: 'added', changes: [] },
        old: { name: 'old', status: 'removed', changes: [] },
      },
    })
    expect(container.querySelector('.table-node')?.classList).toContain('table-node--diff-modified')
    const rows = [...container.querySelectorAll('.table-node__column')]
    const mark = (row: Element | undefined) =>
      row?.querySelector('.table-node__diff-mark')?.textContent ?? null
    expect(rows.map(mark)).toEqual([null, '~', '+', '−'])
    expect(rows[1]?.classList).toContain('table-node__column--modified')
    expect(rows[1]?.querySelector('.table-node__type')?.textContent).toBe('text → varchar(20)')
    expect(rows[1]?.getAttribute('title')).toContain('TYPE text → varchar(20)')
    expect(rows[1]?.getAttribute('title')).toContain('NULL → NOT NULL')
    // Spoken by screen readers; the overview copy of the badge is aria-hidden.
    expect(container.querySelector('.table-node__header .sr-only')?.textContent).toBe(
      'Columns: 1 added, 1 modified, 1 removed',
    )
  })

  it('labels a new table in its header and in the overview name', () => {
    const container = renderNode({
      status: 'added',
      counts: { added: 4, modified: 0, removed: 0 },
      columns: {},
    })
    expect(container.querySelector('.table-node__header')?.textContent).toContain('New')
    expect(container.querySelector('.table-node__overview-name')?.textContent).toBe(
      'order_itemsNew',
    )
  })
})
