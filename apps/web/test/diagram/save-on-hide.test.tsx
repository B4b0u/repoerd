// @vitest-environment jsdom
import type { DbSchema } from '@repoerd/model'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramCanvas } from '../../src/features/diagram/DiagramCanvas'
import { renderWithApp } from '../render'

const { PLACED, fitView, layoutGate } = vi.hoisted(() => ({
  PLACED: new Map([['users', { x: 0, y: 0 }]]),
  fitView: vi.fn(),
  // When set, layoutTables waits for it (a slow first ELK load).
  layoutGate: { wait: undefined as Promise<void> | undefined },
}))

vi.mock('../../src/features/diagram/layout/place-tables', () => ({
  placeTables: async () => ({ positions: PLACED, added: [] }),
}))
vi.mock('../../src/features/diagram/layout/auto-layout', () => ({
  layoutTables: async () => {
    await layoutGate.wait
    return PLACED
  },
}))
// A hanging save is given up quickly in tests.
vi.mock('../../src/features/diagram/layout/position-batcher', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/features/diagram/layout/position-batcher')>()),
  SAVE_TIMEOUT_MS: 150,
}))
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  useReactFlow: () => ({ fitView }),
}))
// A drag cannot be simulated in jsdom: the canvas exposes the drag callback through buttons.
vi.mock('../../src/features/diagram/FlowCanvas', () => ({
  FlowCanvas: (props: {
    onNodeDragStop: (e: unknown, node: unknown, dragged: unknown[]) => void
    onRearrange: () => void
  }) => {
    const node = { id: 'users', position: { x: 10.4, y: 20.6 } }
    return (
      <>
        <button type="button" onClick={() => props.onNodeDragStop(null, node, [node])}>
          drag
        </button>
        <button type="button" onClick={props.onRearrange}>
          Rearrange all tables
        </button>
      </>
    )
  },
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
  },
  enums: {},
  relationships: [],
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fitView.mockClear()
  layoutGate.wait = undefined
})

/** `hang`: the first saves never answer (until aborted by the client's timeout). */
function renderCanvas(hang = 0) {
  const sends: { method: string; keepalive?: boolean }[] = []
  let hanging = hang
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET') return Response.json({ positions: [] })
      sends.push({ method, keepalive: init?.keepalive })
      if (hanging > 0) {
        hanging -= 1
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })
      }
      return new Response(null, { status: 204 })
    }),
  )
  renderWithApp(
    <ReactFlowProvider>
      <DiagramCanvas
        repo={{ owner: 'acme', name: 'shop' }}
        schema={schema}
        sourceId="prisma/schema.prisma"
        mode="ALL_FIELDS"
        onModeChange={() => {}}
        hidden={new Set()}
        onActivate={() => {}}
      />
    </ReactFlowProvider>,
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return sends
}

describe('DiagramCanvas saves around a reload', () => {
  it('sends a pending drag with keepalive when the page is hidden', async () => {
    const user = userEvent.setup()
    const sends = renderCanvas()
    await user.click(await screen.findByRole('button', { name: 'drag' }))
    expect(sends).toHaveLength(0)
    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(sends).toEqual([{ method: 'PATCH', keepalive: true }]))
  })

  it('sends a pending drag when the document becomes hidden', async () => {
    const user = userEvent.setup()
    const sends = renderCanvas()
    await user.click(await screen.findByRole('button', { name: 'drag' }))
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(sends).toEqual([{ method: 'PATCH', keepalive: true }]))
    state.mockRestore()
  })

  it('does not send anything when the document becomes visible', async () => {
    const user = userEvent.setup()
    const sends = renderCanvas()
    await user.click(await screen.findByRole('button', { name: 'drag' }))
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sends).toHaveLength(0)
  })

  it('rearranging drops pending drags: only the rearranged positions are sent, and the view is fitted', async () => {
    const user = userEvent.setup()
    const sends = renderCanvas()
    await user.click(await screen.findByRole('button', { name: 'drag' }))
    await user.click(screen.getByRole('button', { name: 'Rearrange all tables' }))
    await user.click(await screen.findByRole('button', { name: 'Rearrange' }))
    await vi.waitFor(() => expect(sends.map((s) => s.method)).toEqual(['PATCH']))
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(sends.map((s) => s.method)).toEqual(['PATCH'])
    await vi.waitFor(() => expect(fitView).toHaveBeenCalled())
  })

  it('drops a drag made while the new layout is being computed', async () => {
    const user = userEvent.setup()
    const sends = renderCanvas()
    let release = () => {}
    layoutGate.wait = new Promise<void>((resolve) => {
      release = resolve
    })
    await screen.findByRole('button', { name: 'drag' })
    await user.click(screen.getByRole('button', { name: 'Rearrange all tables' }))
    await user.click(await screen.findByRole('button', { name: 'Rearrange' }))
    await user.click(screen.getByRole('button', { name: 'drag' }))
    release()
    await vi.waitFor(() => expect(sends.map((s) => s.method)).toEqual(['PATCH']))
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(sends.map((s) => s.method)).toEqual(['PATCH'])
  })

  it('sends the keepalive save at once when a save is still in flight', async () => {
    const user = userEvent.setup()
    const sends = renderCanvas(1)
    await user.click(await screen.findByRole('button', { name: 'drag' }))
    await vi.waitFor(() => expect(sends).toHaveLength(1)) // the first save hangs
    await user.click(screen.getByRole('button', { name: 'drag' }))
    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(sends).toHaveLength(2), { timeout: 100 })
    expect(sends[1]).toEqual({ method: 'PATCH', keepalive: true })
  })

  it('gives up on a save that never answers, and later saves go through', async () => {
    const user = userEvent.setup()
    const sends = renderCanvas(1)
    await user.click(await screen.findByRole('button', { name: 'drag' }))
    await vi.waitFor(() => expect(sends).toHaveLength(1))
    // Timed out after 150 ms, re-queued, retried after 1 s.
    await vi.waitFor(() => expect(sends).toHaveLength(2), { timeout: 3000 })
  })
})
