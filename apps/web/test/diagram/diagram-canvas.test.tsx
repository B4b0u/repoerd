// @vitest-environment jsdom
import { type DbSchema, diffSchemas, type SchemaDiff } from '@repoerd/model'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramCanvas } from '../../src/features/diagram/DiagramCanvas'
import { i18n } from '../../src/shared/i18n/i18n'
import { renderWithApp } from '../render'

// vi.mock factories run before the module body: share the positions through vi.hoisted.
const { PLACED } = vi.hoisted(() => ({
  PLACED: new Map([
    ['users', { x: 0, y: 0 }],
    ['posts', { x: 400, y: 0 }],
  ]),
}))

// Positions without ELK: posts is new, so it is saved as soon as it is placed.
vi.mock('../../src/features/diagram/layout/place-tables', () => ({
  placeTables: async () => ({ positions: PLACED, added: [{ table: 'posts', x: 400, y: 0 }] }),
}))
vi.mock('../../src/features/diagram/layout/auto-layout', () => ({
  layoutTables: async () => PLACED,
}))
// No automatic retry in these tests: each save answers the next status of `saves` on demand.
vi.mock('../../src/features/diagram/layout/position-batcher', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/features/diagram/layout/position-batcher')>()),
  SAVE_RETRY_DELAYS_MS: [],
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
  relationships: [],
}
const noop = () => {}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Layout reads answer an empty layout; saves answer the next status of `saves`. */
function renderCanvas(saves: number[], diff?: SchemaDiff) {
  const methods: string[] = []
  const bodies: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      methods.push(method)
      if (method !== 'GET') bodies.push(String(init?.body))
      if (method === 'GET') return Response.json({ positions: [] })
      const status = saves.shift() ?? 204
      return status === 204
        ? new Response(null, { status })
        : Response.json(
            {
              error: {
                code: status === 401 ? 'unauthenticated' : 'internal_error',
                message: 'Boom',
              },
            },
            { status },
          )
    }),
  )
  renderWithApp(
    <ReactFlowProvider>
      <DiagramCanvas
        repo={{ owner: 'acme', name: 'shop' }}
        schema={schema}
        sourceId="prisma/schema.prisma"
        mode="ALL_FIELDS"
        onModeChange={noop}
        hidden={new Set()}
        diff={diff}
        onActivate={noop}
      />
    </ReactFlowProvider>,
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return Object.assign(methods, { bodies })
}

async function rearrange(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Rearrange all tables' }))
  await user.click(await screen.findByRole('button', { name: 'Rearrange' }))
}

describe('DiagramCanvas layout feedback', () => {
  it('shows one notice for repeated save failures and removes it once a save works', async () => {
    const user = userEvent.setup()
    const errorSpy = vi.spyOn(toast, 'error')
    const methods = renderCanvas([500, 500, 204])
    expect(await screen.findByText('Layout changes could not be saved.')).toBeTruthy()

    await rearrange(user)
    await vi.waitFor(() => expect(methods.filter((m) => m === 'PATCH')).toHaveLength(2))
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(2))
    expect(errorSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: Number.POSITIVE_INFINITY }),
    )
    expect(screen.getAllByText('Layout changes could not be saved.')).toHaveLength(1)

    await rearrange(user)
    await vi.waitFor(() =>
      expect(screen.queryByText('Layout changes could not be saved.')).toBeNull(),
    )
  })

  it('translates the save failure notice when the language changes', async () => {
    renderCanvas([500])
    expect(await screen.findByText('Layout changes could not be saved.')).toBeTruthy()
    await act(() => i18n.changeLanguage('fr'))
    expect(
      await screen.findByText("Les changements de disposition n'ont pas pu être enregistrés."),
    ).toBeTruthy()
    expect(screen.queryByText('Layout changes could not be saved.')).toBeNull()
  })

  it('shows no failure notice when the session expired during the save', async () => {
    const errorSpy = vi.spyOn(toast, 'error')
    const methods = renderCanvas([401])
    // The new table is saved with a PATCH as soon as it is placed.
    await vi.waitFor(() => expect(methods).toContain('PATCH'))
    // Give the outcome of that save the time to be reported.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(errorSpy).not.toHaveBeenCalled()
    expect(screen.queryByText('Layout changes could not be saved.')).toBeNull()
  })

  it('keeps an existing failure notice when a later save is answered by an expired session', async () => {
    const user = userEvent.setup()
    const errorSpy = vi.spyOn(toast, 'error')
    const dismissSpy = vi.spyOn(toast, 'dismiss')
    const methods = renderCanvas([500, 401])
    expect(await screen.findByText('Layout changes could not be saved.')).toBeTruthy()

    await rearrange(user)
    await vi.waitFor(() => expect(methods.filter((m) => m === 'PATCH')).toHaveLength(2))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(dismissSpy).not.toHaveBeenCalledWith('layout-save-failed')
    expect(screen.getAllByText('Layout changes could not be saved.')).toHaveLength(1)
  })

  it('asks before replacing the layout, and keeps it when cancelled', async () => {
    const user = userEvent.setup()
    const methods = renderCanvas([204])
    await user.click(await screen.findByRole('button', { name: 'Rearrange all tables' }))
    expect(await screen.findByRole('alertdialog', { name: 'Rearrange all tables?' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(methods.filter((m) => m === 'PATCH')).toHaveLength(1)
  })

  it('sends the failed positions again from the notice', async () => {
    const user = userEvent.setup()
    const methods = renderCanvas([500, 204])
    expect(await screen.findByText('Layout changes could not be saved.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await vi.waitFor(() => expect(methods.filter((m) => m === 'PATCH')).toHaveLength(2))
    expect(JSON.parse(methods.bodies[1] ?? '{}')).toEqual({
      positions: [{ table: 'posts', x: 400, y: 0 }],
    })
    await vi.waitFor(() =>
      expect(screen.queryByText('Layout changes could not be saved.')).toBeNull(),
    )
  })

  it('never saves the tables of the reference side only in a comparison', async () => {
    const user = userEvent.setup()
    const after: DbSchema = {
      ...schema,
      tables: Object.fromEntries(
        Object.entries(schema.tables).filter(([name]) => name === 'users'),
      ),
    }
    const methods = renderCanvas([], diffSchemas(schema, after))
    await rearrange(user)
    await vi.waitFor(() => expect(methods.filter((m) => m === 'PATCH')).toHaveLength(1))
    // posts exists on the reference side only: placed, never saved (neither placed nor rearranged).
    expect(JSON.parse(methods.bodies[0] ?? '{}')).toEqual({
      positions: [{ table: 'users', x: 0, y: 0 }],
    })
  })

  it('does not save an auto-placed table of the reference side only in a comparison', async () => {
    const after: DbSchema = {
      ...schema,
      tables: Object.fromEntries(
        Object.entries(schema.tables).filter(([name]) => name === 'users'),
      ),
    }
    const methods = renderCanvas([], diffSchemas(schema, after))
    await screen.findByRole('button', { name: 'Rearrange all tables' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    // posts is auto-placed (the mock adds it) but exists on the reference side only.
    expect(methods.filter((m) => m === 'PATCH')).toHaveLength(0)
  })

  it('keeps the failure notice for a refused save and does not send it again', async () => {
    const methods = renderCanvas([400])
    expect(await screen.findByText('Layout changes could not be saved.')).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(methods.filter((m) => m === 'PATCH')).toHaveLength(1)
    expect(screen.getAllByText('Layout changes could not be saved.')).toHaveLength(1)
    // Final refusal: no "Retry" that would only be refused again.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })
})
