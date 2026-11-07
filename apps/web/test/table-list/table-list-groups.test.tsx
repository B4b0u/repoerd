// @vitest-environment jsdom
import type { DbSchema } from '@repoerd/model'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GroupView } from '../../src/features/diagram/groups/group-view'
import { TableListPane } from '../../src/features/table-list/TableListPane'
import '../../src/shared/i18n/i18n'

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
  tables: Object.fromEntries(
    ['tickets', 'messages', 'users', 'sessions', 'audit'].map((name) => [name, table(name)]),
  ),
  enums: {},
  relationships: [],
}
const groups: GroupView = {
  proposed: false,
  reproposed: false,
  canEdit: false,
  loading: false,
  groups: [
    { id: 'a', name: 'Support', color: '#3b82f6', origins: [] },
    { id: 'b', name: 'Accounts', color: '#ef4444', origins: [] },
  ],
  membership: new Map([
    ['tickets', 'a'],
    ['messages', 'a'],
    ['users', 'b'],
    ['sessions', 'b'],
    ['audit', null],
  ]),
}

function renderPane(hidden: string[] = []) {
  const onSetHidden = vi.fn()
  render(
    <TableListPane
      schema={schema}
      hidden={new Set(hidden)}
      groups={groups}
      onToggle={vi.fn()}
      onShowAll={vi.fn()}
      onHideAll={vi.fn()}
      onSelect={vi.fn()}
      onSetHidden={onSetHidden}
    />,
  )
  return { onSetHidden }
}

describe('TableListPane by group', () => {
  it('lists a section per group, then the ungrouped tables, with counts', () => {
    renderPane()
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Support2', 'Accounts2', 'Ungrouped1'])
    const support = screen.getByRole('region', { name: 'Support' })
    expect(within(support).getByRole('button', { name: 'tickets' })).toBeTruthy()
    expect(within(support).queryByRole('button', { name: 'users' })).toBeNull()
  })

  it('hides then shows a whole group in one call', async () => {
    const user = userEvent.setup()
    const { onSetHidden } = renderPane()
    await user.click(screen.getByRole('checkbox', { name: 'Show the group Support' }))
    expect(onSetHidden).toHaveBeenLastCalledWith(['messages', 'tickets'], true)
    cleanup()
    const second = renderPane(['tickets', 'messages'])
    await user.click(screen.getByRole('checkbox', { name: 'Show the group Support' }))
    expect(second.onSetHidden).toHaveBeenLastCalledWith(['messages', 'tickets'], false)
  })

  it('shows a mixed state when only part of the group is visible', async () => {
    const user = userEvent.setup()
    const { onSetHidden } = renderPane(['tickets'])
    const box = screen.getByRole('checkbox', { name: 'Show the group Support' })
    expect(box.getAttribute('aria-checked')).toBe('mixed')
    await user.click(box)
    expect(onSetHidden).toHaveBeenLastCalledWith(['messages', 'tickets'], false)
  })

  it('collapses a section locally', async () => {
    const user = userEvent.setup()
    renderPane()
    const collapse = screen.getByRole('button', { name: 'Collapse the group Support' })
    expect(collapse.getAttribute('aria-expanded')).toBe('true')
    await user.click(collapse)
    expect(screen.queryByRole('button', { name: 'tickets' })).toBeNull()
    const expand = screen.getByRole('button', { name: 'Expand the group Support' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
  })

  it('hides the sections without a match while searching', async () => {
    const user = userEvent.setup()
    renderPane()
    await user.type(screen.getByRole('searchbox', { name: 'Search tables' }), 'sess')
    expect(screen.getByRole('button', { name: 'sessions' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Support' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Ungrouped' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Accounts' })).toBeTruthy()
  })

  it('stays the plain list without groups', () => {
    render(
      <TableListPane
        schema={schema}
        hidden={new Set()}
        groups={{ ...groups, groups: [] }}
        onToggle={vi.fn()}
        onShowAll={vi.fn()}
        onHideAll={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([])
  })
})
