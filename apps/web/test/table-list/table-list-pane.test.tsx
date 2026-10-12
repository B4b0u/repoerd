// @vitest-environment jsdom
import type { DbSchema } from '@repoerd/model'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TableListPane } from '../../src/features/table-list/TableListPane'
import { i18n } from '../../src/shared/i18n/i18n'

afterEach(() => cleanup())

const table = (name: string) => ({
  name,
  schema: null,
  comment: null,
  columns: [],
  indexes: [],
  constraints: [],
})
const schema: DbSchema = {
  tables: { users: table('users'), posts: table('posts'), orders: table('orders') },
  enums: {},
  relationships: [],
}

function renderPane(hidden: string[] = [], active?: string) {
  const handlers = { onToggle: vi.fn(), onShowAll: vi.fn(), onHideAll: vi.fn(), onSelect: vi.fn() }
  render(<TableListPane schema={schema} hidden={new Set(hidden)} active={active} {...handlers} />)
  return handlers
}

describe('TableListPane', () => {
  it('keeps its landmark name when collapsed', async () => {
    const user = userEvent.setup()
    renderPane()
    await user.click(screen.getByRole('button', { name: 'Hide the table list' }))
    expect(screen.getByRole('complementary', { name: 'Tables' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Show the table list' }))
    expect(screen.getByRole('searchbox', { name: 'Search tables' })).toBeTruthy()
  })

  it('shows and hides tables with their checkboxes, and counts the visible ones', async () => {
    const user = userEvent.setup()
    const { onToggle } = renderPane(['posts'])
    const posts = screen.getByRole('checkbox', { name: 'Show posts' })
    expect(posts.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('checkbox', { name: 'Show users' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    await user.click(screen.getByRole('checkbox', { name: 'Show users' }))
    expect(onToggle).toHaveBeenCalledWith('users')
    expect(screen.getByText('Tables shown: 2 of 3')).toBeTruthy()
  })

  it('selects a table by its name and marks the active one', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderPane([], 'orders')
    expect(screen.getByRole('button', { name: 'orders' }).getAttribute('aria-current')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'users' }))
    expect(onSelect).toHaveBeenCalledWith('users')
  })

  it('filters the list, and offers show all and hide all only when they change something', async () => {
    const user = userEvent.setup()
    renderPane()
    expect((screen.getByRole('button', { name: 'Show all' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: 'Hide all' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
    await user.type(screen.getByRole('searchbox', { name: 'Search tables' }), 'zzz')
    expect(screen.getByText('No table matches.')).toBeTruthy()
  })

  it('keeps only the tables matching the search', async () => {
    const user = userEvent.setup()
    renderPane(['posts'])
    await user.type(screen.getByRole('searchbox', { name: 'Search tables' }), 'us')
    expect(screen.getByRole('button', { name: 'users' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'posts' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'orders' })).toBeNull()
    expect(screen.queryByText('No table matches.')).toBeNull()
    // The count is about the whole schema, not about the filter.
    expect(screen.getByText('2/3')).toBeTruthy()
  })

  it('shows the number of visible tables out of all of them', () => {
    renderPane(['posts', 'orders'])
    expect(screen.getByText('1/3')).toBeTruthy()
  })

  it('shows all and hides all on request', async () => {
    const user = userEvent.setup()
    const { onShowAll, onHideAll } = renderPane(['posts'])
    await user.click(screen.getByRole('button', { name: 'Show all' }))
    expect(onShowAll).toHaveBeenCalledTimes(1)
    expect(onHideAll).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Hide all' }))
    expect(onHideAll).toHaveBeenCalledTimes(1)
  })

  it('speaks French', async () => {
    renderPane()
    await act(() => i18n.changeLanguage('fr'))
    expect(screen.getByRole('checkbox', { name: 'Afficher users' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tout masquer' })).toBeTruthy()
  })
})

describe('TableListPane in a comparison', () => {
  it('opens on the Changes tab and keeps the table list in the second tab', async () => {
    const schema = {
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
    render(
      <TableListPane
        schema={schema}
        hidden={new Set()}
        onToggle={() => {}}
        onShowAll={() => {}}
        onHideAll={() => {}}
        onSelect={() => {}}
        changes={{ label: 'Changes (2)', content: <p>the changes</p> }}
      />,
    )
    expect(screen.getByRole('tab', { name: 'Changes (2)', selected: true })).toBeTruthy()
    expect(screen.getByText('the changes')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Tables' }))
    expect(screen.getByRole('searchbox', { name: 'Search tables' })).toBeTruthy()
  })
})
