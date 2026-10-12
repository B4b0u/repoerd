// @vitest-environment jsdom
import {
  type Column,
  type DbSchema,
  deriveRelationships,
  diffSchemas,
  type Table,
  unionSchema,
} from '@repoerd/model'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TableDetailPanel } from '../../src/features/table-detail/TableDetailPanel'
import { i18n } from '../../src/shared/i18n/i18n'

afterEach(() => cleanup())

const schema: DbSchema = {
  tables: {
    posts: {
      name: 'posts',
      schema: null,
      comment: 'Blog posts',
      columns: [
        {
          name: 'id',
          type: 'uuid',
          notNull: true,
          default: 'gen_random_uuid()',
          comment: null,
          isPrimaryKey: true,
          isUnique: false,
        },
        {
          name: 'author_id',
          type: 'uuid',
          notNull: false,
          default: null,
          comment: 'Who wrote it',
          isPrimaryKey: false,
          isUnique: false,
        },
      ],
      indexes: [{ name: 'posts_author_idx', columns: ['author_id'], type: 'btree', unique: false }],
      constraints: [
        {
          kind: 'foreignKey',
          name: 'posts_author_fk',
          columns: ['author_id'],
          targetTable: 'users',
          targetColumns: ['id'],
          onDelete: 'CASCADE',
          onUpdate: 'NO_ACTION',
        },
      ],
    },
  },
  enums: {},
  relationships: [],
}

const bare: DbSchema = {
  tables: {
    tags: {
      name: 'tags',
      schema: null,
      comment: null,
      columns: [
        {
          name: 'label',
          type: 'text',
          notNull: true,
          default: null,
          comment: null,
          isPrimaryKey: false,
          isUnique: false,
        },
      ],
      indexes: [],
      constraints: [],
    },
  },
  enums: {},
  relationships: [],
}

function renderPanel(onClose = vi.fn()) {
  render(<TableDetailPanel schema={schema} tableName="posts" onClose={onClose} />)
  return onClose
}

/** The block of a column: its name, type and trait badges. */
const columnBlock = (name: string) =>
  screen.getByText(name, { selector: 'span' }).closest('.flex-col') as HTMLElement
/** The block of a named constraint or index. */
const namedBlock = (name: string) => screen.getByText(name).closest('.flex-col') as HTMLElement

describe('TableDetailPanel', () => {
  it('shows the traits of each column as badges, with the default value', () => {
    renderPanel()
    expect(screen.getByRole('complementary', { name: 'Details of posts' })).toBeTruthy()
    expect(screen.getByText('Primary key')).toBeTruthy()
    expect(screen.getByText('Not null')).toBeTruthy()
    expect(screen.getByText('Nullable')).toBeTruthy()
    // Once as a column trait, once as the kind of the constraint.
    expect(within(columnBlock('author_id')).getByText('Foreign key')).toBeTruthy()
    expect(within(namedBlock('posts_author_fk')).getByText('Foreign key')).toBeTruthy()
    expect(within(columnBlock('id')).queryByText('Foreign key')).toBeNull()
    expect(screen.getByText('gen_random_uuid()')).toBeTruthy()
    expect(
      screen.getByText('author_id → users.id · ON DELETE CASCADE · ON UPDATE NO ACTION'),
    ).toBeTruthy()
  })

  it('shows nothing for a table named like an Object member', () => {
    const { container } = render(
      <TableDetailPanel schema={schema} tableName="constructor" onClose={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows the unique flag and the type of an index', () => {
    const posts = schema.tables.posts as Table
    render(
      <TableDetailPanel
        schema={{
          ...schema,
          tables: {
            posts: {
              ...posts,
              indexes: [
                { name: 'posts_slug_key', columns: ['slug'], type: 'hash', unique: true },
                { name: 'posts_plain', columns: ['id'], type: '', unique: false },
              ],
            },
          },
        }}
        tableName="posts"
        onClose={vi.fn()}
      />,
    )
    const unique = within(namedBlock('posts_slug_key'))
    expect(unique.getByText('Unique')).toBeTruthy()
    expect(unique.getByText('hash')).toBeTruthy()
    const plain = within(namedBlock('posts_plain'))
    expect(plain.queryByText('Unique')).toBeNull()
    expect(plain.queryByText('btree')).toBeNull()
  })

  it('says when a table has no index and no constraint', () => {
    render(<TableDetailPanel schema={bare} tableName="tags" onClose={vi.fn()} />)
    expect(screen.getByText('No index.')).toBeTruthy()
    expect(screen.getByText('No constraint.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Related tables/ })).toBeNull()
  })

  it('shows the related tables section when it has content', () => {
    render(
      <TableDetailPanel schema={schema} tableName="posts" onClose={vi.fn()}>
        <p>users, comments</p>
      </TableDetailPanel>,
    )
    expect(screen.getByRole('button', { name: /^Related tables/ })).toBeTruthy()
    expect(screen.getByText('users, comments')).toBeTruthy()
  })

  it('folds a section away and back', async () => {
    const user = userEvent.setup()
    renderPanel()
    const columns = screen.getByRole('button', { name: /^Columns/ })
    expect(columns.textContent).toContain('2')
    await user.click(columns)
    expect(screen.queryByText('Who wrote it')).toBeNull()
    await user.click(columns)
    expect(screen.getByText('Who wrote it')).toBeTruthy()
  })

  it('closes', async () => {
    const user = userEvent.setup()
    const onClose = renderPanel()
    await user.click(screen.getByRole('button', { name: 'Close details' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('speaks French, schema content aside', async () => {
    renderPanel()
    await act(() => i18n.changeLanguage('fr'))
    expect(screen.getByText('Clé primaire')).toBeTruthy()
    expect(screen.getByText('Peut être nul')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Colonnes/ })).toBeTruthy()
    expect(screen.getByText('posts_author_fk')).toBeTruthy()
  })

  it('overlays the canvas below 1280 px and sits beside it from there', () => {
    renderPanel()
    const panel = screen.getByRole('complementary', { name: 'Details of posts' })
    expect(panel.className).toContain('absolute')
    expect(panel.className).toContain('xl:static')
  })
})

describe('TableDetailPanel in a comparison', () => {
  const col = (name: string, overrides: Partial<Column> = {}): Column => ({
    name,
    type: 'text',
    notNull: false,
    default: null,
    comment: null,
    isPrimaryKey: false,
    isUnique: false,
    ...overrides,
  })
  const fk = (onDelete: string) => ({
    kind: 'foreignKey' as const,
    name: 'posts_author_fk',
    columns: ['author_id'],
    targetTable: 'users',
    targetColumns: ['id'],
    onDelete,
    onUpdate: 'NO_ACTION',
  })
  const side = (posts: Table): DbSchema => {
    const tables = {
      users: {
        name: 'users',
        schema: null,
        comment: null,
        columns: [col('id')],
        indexes: [],
        constraints: [],
      },
      posts,
    }
    return { tables, enums: {}, relationships: deriveRelationships(tables) }
  }
  const before = side({
    name: 'posts',
    schema: null,
    comment: null,
    columns: [col('id'), col('author_id'), col('body'), col('legacy')],
    indexes: [],
    constraints: [fk('CASCADE')],
  })
  const after = side({
    name: 'posts',
    schema: null,
    comment: 'Blog posts',
    columns: [
      col('id'),
      col('author_id', { notNull: true }),
      col('body', { type: 'varchar(10)' }),
      col('slug'),
    ],
    indexes: [],
    constraints: [fk('RESTRICT')],
  })

  const renderCompared = () =>
    render(
      <TableDetailPanel
        schema={unionSchema(before, after)}
        tableName="posts"
        onClose={() => {}}
        diff={diffSchemas(before, after).tables.posts}
      />,
    ).container

  it('shows the table status and the before and after of every change', () => {
    const container = renderCompared()
    expect(container.querySelector('header')?.textContent).toContain('Modified')
    expect(screen.getByText('Blog posts', { selector: 'ins' })).toBeTruthy()
    expect(screen.getByText('text', { selector: 'del' })).toBeTruthy()
    expect(screen.getByText('varchar(10)', { selector: 'ins' })).toBeTruthy()
    expect(screen.getByText('nullable', { selector: 'del' })).toBeTruthy()
    expect(screen.getByText('not null', { selector: 'ins' })).toBeTruthy()
    expect(screen.getByText('CASCADE', { selector: 'del' })).toBeTruthy()
    expect(screen.getByText('RESTRICT', { selector: 'ins' })).toBeTruthy()
  })

  it('marks added and removed columns, the removed one struck through', () => {
    renderCompared()
    expect(screen.getAllByText('Added').length).toBeGreaterThan(0)
    expect(screen.getByText('legacy').className).toContain('line-through')
  })

  it('names the changed fields in French', async () => {
    await act(() => i18n.changeLanguage('fr'))
    renderCompared()
    expect(screen.getByText('Valeurs nulles')).toBeTruthy()
    expect(screen.getByText('non nul', { selector: 'ins' })).toBeTruthy()
  })
})
