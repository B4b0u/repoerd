// @vitest-environment jsdom
import {
  type Column,
  type DbSchema,
  deriveRelationships,
  diffSchemas,
  type Table,
} from '@repoerd/model'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChangesPanel } from '../../src/features/compare/ChangesPanel'

afterEach(cleanup)

const column = (name: string): Column => ({
  name,
  type: 'text',
  notNull: false,
  default: null,
  comment: null,
  isPrimaryKey: name === 'id',
  isUnique: false,
})
const table = (name: string, columns: string[], extra: Partial<Table> = {}): Table => ({
  name,
  schema: null,
  comment: null,
  columns: columns.map(column),
  indexes: [],
  constraints: [],
  ...extra,
})
const schema = (tables: Table[], enums: DbSchema['enums'] = {}): DbSchema => {
  const byName = Object.fromEntries(tables.map((t) => [t.name, t]))
  return { tables: byName, enums, relationships: deriveRelationships(byName) }
}

const diff = diffSchemas(
  schema([table('users', ['id', 'nickname']), table('posts', ['id']), table('legacy', ['id'])], {
    status: { name: 'status', values: ['a', 'b'] },
  }),
  schema(
    [
      table('users', ['id', 'email']),
      table('posts', ['id'], {
        indexes: [{ name: 'posts_idx', columns: ['id'], type: '', unique: false }],
      }),
      table('tags', ['id']),
    ],
    { status: { name: 'status', values: ['b', 'c'] }, fresh: { name: 'fresh', values: ['x'] } },
  ),
)

function renderPanel(overrides: Partial<Parameters<typeof ChangesPanel>[0]> = {}) {
  const props = {
    diff,
    onlyChanged: false,
    onOnlyChangedChange: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  }
  render(<ChangesPanel {...props} />)
  return props
}

describe('ChangesPanel', () => {
  it('lists the changed tables, added first, each with its symbol and a summary', () => {
    renderPanel()
    const tables = within(screen.getByRole('region', { name: 'Tables' }))
    expect(tables.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '+tagsnew',
      '~posts1 index changed',
      '~users+1 −1',
      '−legacyremoved',
    ])
  })

  it('selects a table and marks the active one', async () => {
    const props = renderPanel({ active: 'users' })
    const tables = within(screen.getByRole('region', { name: 'Tables' }))
    expect(tables.getByRole('button', { name: /^users/ }).getAttribute('aria-current')).toBe('true')
    await userEvent.setup().click(tables.getByRole('button', { name: /^posts/ }))
    expect(props.onSelect).toHaveBeenCalledWith('posts')
  })

  it('switches to the changed tables only', async () => {
    const props = renderPanel()
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Only changed tables' }))
    expect(props.onOnlyChangedChange).toHaveBeenCalledWith(true)
  })

  it('shows the values of a changed enum on demand', async () => {
    renderPanel()
    const enums = within(screen.getByRole('region', { name: 'Enums' }))
    expect(enums.getByRole('button', { name: /^fresh/ }).textContent).toContain('new enum')
    await userEvent.setup().click(enums.getByRole('button', { name: /^status/ }))
    expect(enums.getByText('Added values: c')).toBeTruthy()
    expect(enums.getByText('Removed values: a')).toBeTruthy()
  })
})
