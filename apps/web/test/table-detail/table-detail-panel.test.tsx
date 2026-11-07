// @vitest-environment jsdom
import type { TableGroupsResponse } from '@repoerd/contracts'
import {
  type Column,
  type DbSchema,
  deriveRelationships,
  diffSchemas,
  GROUP_PALETTE,
  type Table,
  unionSchema,
} from '@repoerd/model'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GroupSelect } from '../../src/features/diagram/groups/GroupSelect'
import { GroupEditingProvider } from '../../src/features/diagram/groups/group-editing'
import { buildGroupView } from '../../src/features/diagram/groups/group-view'
import { useViewState } from '../../src/features/diagram/view-state'
import { TableDetailPanel } from '../../src/features/table-detail/TableDetailPanel'
import { i18n } from '../../src/shared/i18n/i18n'
import { fakeGroupsServer } from '../groups-server'
import { renderWithApp } from '../render'

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

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

  it('shows the file declaring the table, labelled, and nothing without one', async () => {
    const posts = schema.tables.posts as Table
    const withFile = {
      ...schema,
      tables: { posts: { ...posts, file: 'src/db/schema/tickets.ts' } },
    }
    const { unmount } = render(
      <TableDetailPanel schema={withFile} tableName="posts" onClose={vi.fn()} />,
    )
    const path = screen.getByText('src/db/schema/tickets.ts')
    expect(path.closest('p')?.textContent).toContain('File')
    expect(path.closest('p')?.getAttribute('title')).toBe('src/db/schema/tickets.ts')
    await act(() => i18n.changeLanguage('fr'))
    expect(screen.getByText('Fichier')).toBeTruthy()
    unmount()
    await act(() => i18n.changeLanguage('en'))
    renderPanel()
    expect(screen.queryByText('File')).toBeNull()
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

describe('TableDetailPanel hub checkbox', () => {
  it('toggles the explicit hubs list in the URL', async () => {
    window.history.replaceState(null, '', '/acme/shop')
    function Probe() {
      const [state, update] = useViewState('acme', 'shop')
      const hubs = state.hubs ?? []
      return (
        <TableDetailPanel
          schema={schema}
          tableName="posts"
          onClose={vi.fn()}
          isHub={hubs.includes('posts')}
          onHubChange={(on) => {
            update(
              { hubs: on ? [...hubs, 'posts'] : hubs.filter((name) => name !== 'posts') },
              { replace: true },
            )
          }}
        />
      )
    }
    render(<Probe />)
    const checkbox = screen.getByRole('checkbox', { name: 'Treat as hub table' })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(checkbox)
    expect(window.location.search).toContain('hubs=posts')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Treat as hub table' }))
    expect(window.location.search).toMatch(/hubs=(&|$)/)
  })
})

describe('TableDetailPanel group', () => {
  afterEach(() => vi.unstubAllGlobals())

  const plain = (name: string, file: string): Table => ({
    name,
    schema: null,
    comment: null,
    columns: [],
    indexes: [],
    constraints: [],
    file,
  })
  const grouped: DbSchema = {
    tables: {
      posts: plain('posts', 'db/posts.ts'),
      comments: plain('comments', 'db/posts.ts'),
      tags: plain('tags', 'db/tags.ts'),
      notes: plain('notes', 'db/notes.ts'),
    },
    enums: {},
    relationships: [],
  }
  const content = {
    id: 'content',
    name: 'content',
    color: GROUP_PALETTE[0] as string,
    origins: [{ kind: 'file' as const, path: 'db/posts.ts' }],
  }
  const misc = {
    id: 'misc',
    name: 'misc',
    color: GROUP_PALETTE[1] as string,
    origins: [{ kind: 'file' as const, path: 'db/tags.ts' }],
  }
  const saved: Omit<TableGroupsResponse, 'canEdit'> = {
    configured: true,
    groups: [content, misc],
    assignments: {},
  }

  function renderGrouped(
    state: Omit<TableGroupsResponse, 'canEdit'> = saved,
    { canEdit = true, table = 'posts' } = {},
  ) {
    const server = fakeGroupsServer(state, { canEdit })
    const response = { ...state, canEdit }
    renderWithApp(
      <GroupEditingProvider
        repo={{ owner: 'acme', name: 'shop' }}
        sourceId="db"
        schema={grouped}
        view={buildGroupView(grouped, response)}
        saved={response}
      >
        <TableDetailPanel
          schema={grouped}
          tableName={table}
          onClose={vi.fn()}
          group={<GroupSelect table={table} />}
        />
      </GroupEditingProvider>,
      server.client,
    )
    return server
  }

  const PATCH = '/api/repos/acme/shop/groups-assignments?source=db'

  async function choose(option: string) {
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Group' }))
    await user.click(await screen.findByRole('option', { name: option }))
    return user
  }

  it('shows the group of the table and places it in another one', async () => {
    const server = renderGrouped()
    const select = screen.getByRole('combobox', { name: 'Group' })
    expect(select.textContent).toContain('content')
    const user = userEvent.setup()
    await user.click(select)
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
    // No "Follow its file": the table already does.
    expect(options).toEqual(['content', 'misc', 'Ungrouped', 'New group…'])
    await user.click(screen.getByRole('option', { name: 'misc' }))
    await waitFor(() => expect(server.sent).toHaveLength(1))
    expect(server.sent[0]).toEqual({
      method: 'PATCH',
      path: PATCH,
      body: { assignments: { posts: 'misc' }, clear: [] },
    })
    expect(await screen.findByText('1 table placed in "misc".')).toBeTruthy()
  })

  it('gives a table placed by hand back to its file', async () => {
    const server = renderGrouped({ ...saved, assignments: { posts: 'misc' } })
    expect(screen.getByRole('combobox', { name: 'Group' }).textContent).toContain('misc')
    await choose('Follow its file')
    await waitFor(() => expect(server.sent).toHaveLength(1))
    expect(server.sent[0]).toEqual({
      method: 'PATCH',
      path: PATCH,
      body: { assignments: {}, clear: ['posts'] },
    })
  })

  it('takes the table out of any group', async () => {
    const server = renderGrouped()
    await choose('Ungrouped')
    await waitFor(() => expect(server.sent).toHaveLength(1))
    expect(server.sent[0]?.body).toEqual({ assignments: { posts: null }, clear: [] })
  })

  it('creates a group and places the table in it, as one gesture', async () => {
    const server = renderGrouped()
    const user = await choose('New group…')
    const name = screen.getByRole('textbox', { name: 'Name of the new group' })
    await waitFor(() => expect(document.activeElement).toBe(name))
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    await user.type(name, ' Archive {Enter}')
    await waitFor(() => expect(server.sent).toHaveLength(2))
    const [created, placed] = server.sent
    const id = created?.path.match(/\/groups\/([^?]+)\?/)?.[1] as string
    expect(created).toEqual({
      method: 'PUT',
      path: `/api/repos/acme/shop/groups/${id}?source=db`,
      body: { name: 'Archive', color: GROUP_PALETTE[2], origins: [] },
    })
    expect(placed).toEqual({
      method: 'PATCH',
      path: PATCH,
      body: { assignments: { posts: id }, clear: [] },
    })
    // One gesture: one notice, one undo.
    expect(await screen.findAllByText('1 table placed in "Archive".')).toHaveLength(1)
    expect(screen.queryByRole('textbox', { name: 'Name of the new group' })).toBeNull()
  })

  it('shows the group as text, without any control, without the push right', () => {
    renderGrouped(saved, { canEdit: false })
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText('content').closest('p')?.textContent).toContain('Group')
  })

  it('says "Ungrouped" for a table in no group, without the push right', () => {
    renderGrouped(saved, { canEdit: false, table: 'notes' })
    expect(screen.getByText('Ungrouped').closest('p')?.textContent).toContain('Group')
  })

  it('says it in French', async () => {
    await act(() => i18n.changeLanguage('fr'))
    renderGrouped({ ...saved, assignments: { posts: 'misc' } })
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Groupe' }))
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(options).toEqual([
      "D'après son fichier",
      'content',
      'misc',
      'Hors groupe',
      'Nouveau groupe…',
    ])
  })

  it('shows nothing about groups outside the diagram workspace', () => {
    render(
      <TableDetailPanel
        schema={grouped}
        tableName="posts"
        onClose={vi.fn()}
        group={<GroupSelect table="posts" />}
      />,
    )
    expect(screen.queryByText('Group')).toBeNull()
  })
})
