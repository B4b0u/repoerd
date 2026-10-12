import type { DbSchema } from '@repoerd/model'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  bundled: false,
  created: [] as string[],
  fail: false,
  slow: undefined as (() => void) | undefined,
}))

vi.mock('elkjs/lib/elk.bundled.js', async (importOriginal) => {
  state.bundled = true
  return importOriginal()
})

// ELK's API without its real worker: each layout answers through the worker the API created.
vi.mock('elkjs/lib/elk-api.js', () => ({
  default: class {
    private readonly worker: EventTarget
    constructor(options: { workerFactory: () => EventTarget }) {
      this.worker = options.workerFactory()
    }
    layout(graph: { children?: { id: string }[] }) {
      if (state.fail) {
        // A worker that cannot start: only its error event ever comes.
        this.worker.dispatchEvent(new Event('error'))
        return new Promise(() => {})
      }
      const answer = {
        ...graph,
        children: (graph.children ?? []).map((child, index) => ({ ...child, x: index * 10, y: 0 })),
      }
      if (graph.children?.some((child) => child.id === 'boom')) {
        return Promise.reject(new Error('invalid graph'))
      }
      if (graph.children?.some((child) => child.id === 'slow')) {
        return new Promise((resolve) => {
          state.slow = () => resolve(answer)
        })
      }
      return Promise.resolve(answer)
    }
    terminateWorker() {
      // Like elk-api: the layouts in progress are never settled.
      state.slow = undefined
    }
  },
}))

class FakeWorker extends EventTarget {
  constructor(readonly url: string) {
    super()
    state.created.push(url)
  }
  postMessage() {}
  terminate() {}
}

const table = (name: string) => ({
  name,
  schema: null,
  comment: null,
  columns: [],
  indexes: [],
  constraints: [],
})
const SCHEMA = {
  tables: { users: table('users'), posts: table('posts') },
  enums: {},
  relationships: [],
} as unknown as DbSchema

afterEach(() => {
  vi.unstubAllGlobals()
  state.fail = false
})

describe('auto-layout in a Web Worker', () => {
  it('runs ELK in a worker started from the emitted worker file, never on the main thread', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const { layoutTables } = await import('../../src/features/diagram/layout/auto-layout')
    const positions = await layoutTables(SCHEMA, ['users', 'posts'])
    expect(positions.get('posts')).toEqual({ x: 0, y: 0 })
    expect(positions.get('users')).toEqual({ x: 10, y: 0 })
    expect(state.created).toHaveLength(1)
    expect(state.created[0]).toMatch(/elk-worker\.min\.js/)
    expect(state.bundled).toBe(false)
  })

  it('fails the layout when the worker cannot start, and starts a new one next time', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const { layoutTables } = await import('../../src/features/diagram/layout/auto-layout')
    state.fail = true
    await expect(layoutTables(SCHEMA, ['users'])).rejects.toThrow('The layout worker stopped')
    state.fail = false
    const before = state.created.length
    expect((await layoutTables(SCHEMA, ['users'])).get('users')).toEqual({ x: 0, y: 0 })
    expect(state.created).toHaveLength(before + 1)
  })

  it('keeps the other layouts in progress when ELK rejects one graph', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const { layoutTables } = await import('../../src/features/diagram/layout/auto-layout')
    const schema = {
      ...SCHEMA,
      tables: { ...SCHEMA.tables, slow: table('slow'), boom: table('boom') },
    } as unknown as DbSchema
    const before = state.created.length
    const slow = layoutTables(schema, ['slow'])
    await vi.waitFor(() => expect(state.slow).toBeDefined())
    await expect(layoutTables(schema, ['boom'])).rejects.toThrow('invalid graph')
    state.slow?.()
    expect((await slow).get('slow')).toEqual({ x: 0, y: 0 })
    expect(state.created).toHaveLength(before)
  })
})
