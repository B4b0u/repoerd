// @vitest-environment jsdom
import { type DbSchema, diffSchemas } from '@repoerd/model'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramWorkspace } from '../../src/features/diagram/DiagramWorkspace'
import type { ViewState } from '../../src/features/diagram/view-state'
import { renderWithApp } from '../render'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const tableOf = (name: string) => ({
  name,
  schema: null,
  comment: null,
  columns: [
    {
      name: 'id',
      type: 'text',
      notNull: false,
      default: null,
      comment: null,
      isPrimaryKey: true,
      isUnique: false,
    },
  ],
  indexes: [],
  constraints: [],
})
const schemaOf = (...names: string[]): DbSchema => ({
  tables: Object.fromEntries(names.map((name) => [name, tableOf(name)])),
  enums: {},
  relationships: [],
})

// "users" is unchanged, "reviews" is new: with "only changed tables", the canvas hides "users".
const before = schemaOf('users')
const union = schemaOf('users', 'reviews')
const diff = diffSchemas(before, union)

async function renderTablesTab(viewState: Partial<ViewState> = {}) {
  // The canvas waits for the layout: these tests look at the side panes.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Promise<Response>(() => {})),
  )
  const updateView = vi.fn()
  renderWithApp(
    <DiagramWorkspace
      repo={{ owner: 'acme', name: 'shop' }}
      schema={union}
      sourceId="prisma/schema.prisma"
      viewState={{ hidden: [], changed: true, ...viewState }}
      updateView={updateView}
      diff={diff}
    />,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name: 'Tables' }))
  return { user, updateView }
}

describe('Tables tab under "only changed tables"', () => {
  it('shows the unchanged table as hidden and counts what the canvas shows', async () => {
    await renderTablesTab()
    expect(screen.getByRole('checkbox', { name: 'Show users' }).getAttribute('aria-checked')).toBe(
      'false',
    )
    expect(
      screen.getByRole('checkbox', { name: 'Show reviews' }).getAttribute('aria-checked'),
    ).toBe('true')
    expect(screen.getByText('Tables shown: 1 of 2')).toBeTruthy()
  })

  it('turns the switch off, not the URL hidden list, when an unchanged table is checked', async () => {
    const { user, updateView } = await renderTablesTab()
    await user.click(screen.getByRole('checkbox', { name: 'Show users' }))
    expect(updateView).toHaveBeenCalledTimes(1)
    const [patch] = updateView.mock.calls[0] ?? []
    expect(patch).toHaveProperty('changed', undefined)
    expect(patch.hidden ?? []).toEqual([])
    expect(patch.shown).toBeUndefined()
  })

  it('keeps hiding through the URL list when a visible table is unchecked', async () => {
    const { user, updateView } = await renderTablesTab()
    await user.click(screen.getByRole('checkbox', { name: 'Show reviews' }))
    expect(updateView).toHaveBeenCalledWith(
      expect.objectContaining({ hidden: expect.anything() }),
      { replace: true },
    )
    expect(updateView.mock.calls[0]?.[0]).not.toHaveProperty('changed')
  })

  it('shows everything, switch off and hidden list cleared, with "Show all"', async () => {
    const { user, updateView } = await renderTablesTab()
    await user.click(screen.getByRole('button', { name: 'Show all' }))
    expect(updateView).toHaveBeenCalledWith(
      { hidden: [], shown: undefined, changed: undefined },
      { replace: true },
    )
    expect(updateView.mock.calls[0]?.[0]).toHaveProperty('changed', undefined)
  })

  it('leaves "only changed tables" when an unchanged table is selected by its name', async () => {
    const { user, updateView } = await renderTablesTab()
    await user.click(screen.getByRole('button', { name: 'users' }))
    expect(updateView).toHaveBeenCalledWith(
      expect.objectContaining({ active: 'users', changed: undefined }),
    )
    expect(updateView.mock.calls[0]?.[0]).toHaveProperty('changed', undefined)
  })
})

describe('Default display mode of a comparison', () => {
  const names = (count: number) => Array.from({ length: count }, (_, i) => `t${i}`)

  async function layoutModes(defaultModeTableCount?: number) {
    const requested: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(String(url))
        return new Promise<Response>(() => {})
      }),
    )
    // The union (31 tables) crosses the compact threshold, the compared branch (30) does not.
    const big = schemaOf(...names(31))
    renderWithApp(
      <DiagramWorkspace
        repo={{ owner: 'acme', name: 'shop' }}
        schema={big}
        sourceId="prisma/schema.prisma"
        viewState={{ hidden: [] }}
        updateView={vi.fn()}
        diff={diffSchemas(schemaOf(...names(1)), big)}
        defaultModeTableCount={defaultModeTableCount}
      />,
    )
    await vi.waitFor(() => expect(requested.some((url) => url.includes('/layout'))).toBe(true))
    return requested.filter((url) => url.includes('/layout'))
  }

  it('is chosen from the compared branch table count, like outside the comparison', async () => {
    const [url] = await layoutModes(30)
    expect(url).toContain('ALL_FIELDS')
  })

  it('falls back to the schema table count without it', async () => {
    const [url] = await layoutModes()
    expect(url).toContain('TABLE_NAME')
  })
})
