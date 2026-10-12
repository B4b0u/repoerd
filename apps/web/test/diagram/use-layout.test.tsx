// @vitest-environment jsdom
import type { TablePosition } from '@repoerd/model'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { savePositions, trackLayoutSave, useLayout } from '../../src/features/diagram/api'

const repo = { owner: 'acme', name: 'shop' }
const saved: TablePosition[] = [{ table: 'users', x: 1, y: 2 }]

function Probe({ seen }: { seen: TablePosition[][] }) {
  const layout = useLayout(repo, 'prisma/schema.prisma', 'ALL_FIELDS')
  if (layout.data) seen.push(layout.data.positions)
  return null
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useLayout', () => {
  it('never serves a layout fetched before the component mounted', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++
        const positions = calls === 1 ? [] : saved
        return new Response(JSON.stringify({ positions }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const client = new QueryClient()
    const first: TablePosition[][] = []
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <Probe key="first" seen={first} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(first).toHaveLength(1))

    // Remount in the same commit (what happens when the canvas key changes after a refresh).
    const second: TablePosition[][] = []
    rerender(
      <QueryClientProvider client={client}>
        <Probe key="second" seen={second} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(second.at(-1)).toEqual(saved))
    expect(second[0]).toEqual(saved)
  })

  it('waits for pending saves of the same layout before fetching it', async () => {
    const calls: string[] = []
    let finishSave = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        calls.push(method)
        if (method === 'PATCH') {
          await new Promise<void>((resolve) => {
            finishSave = resolve
          })
          return new Response(null, { status: 204 })
        }
        return Response.json({ positions: saved })
      }),
    )
    // A canvas unmounting flushes its last drag, and its replacement fetches the layout at once.
    const save = savePositions(repo, 'prisma/schema.prisma', 'ALL_FIELDS', saved)
    const seen: TablePosition[][] = []
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe seen={seen} />
      </QueryClientProvider>,
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toEqual(['PATCH'])

    finishSave()
    await save
    await waitFor(() => expect(seen.at(-1)).toEqual(saved))
    expect(calls).toEqual(['PATCH', 'GET'])
  })

  it('waits for a tracked flush that sends nothing itself before fetching the layout', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: RequestInit) => {
        calls.push(init?.method ?? 'GET')
        return Response.json({ positions: saved })
      }),
    )
    let finishFlush = () => {}
    const flush = new Promise<void>((resolve) => {
      finishFlush = resolve
    })
    const tracked = trackLayoutSave(repo, 'prisma/schema.prisma', 'ALL_FIELDS', flush)
    const seen: TablePosition[][] = []
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe seen={seen} />
      </QueryClientProvider>,
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toEqual([])

    finishFlush()
    await tracked
    await waitFor(() => expect(seen.at(-1)).toEqual(saved))
    expect(calls).toEqual(['GET'])
  })

  it('does not let a failed tracked flush break the fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ positions: saved })),
    )
    const tracked = trackLayoutSave(
      repo,
      'prisma/schema.prisma',
      'ALL_FIELDS',
      Promise.reject(new Error('offline')),
    )
    await expect(tracked).resolves.toBeUndefined()
    const seen: TablePosition[][] = []
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe seen={seen} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(seen.at(-1)).toEqual(saved))
  })

  it('asks the server to inherit a moved source layout when told to', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        return Response.json({ positions: [] })
      }),
    )
    function Inheriting() {
      useLayout(repo, 'db/schema.prisma', 'ALL_FIELDS', true)
      return null
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Inheriting />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(urls).toHaveLength(1))
    expect(urls[0]).toBe(
      '/api/repos/acme/shop/layout?source=db%2Fschema.prisma&mode=ALL_FIELDS&inherit=1',
    )
  })
})
