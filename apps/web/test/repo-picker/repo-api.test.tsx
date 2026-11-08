// @vitest-environment jsdom
import { apiPaths, type RepoDto, type RepoListResponse } from '@repoerd/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useFavoriteToggle,
  useRepoFormatPolling,
  useRepoList,
  useSchemaOnly,
} from '../../src/features/repo-picker/api'
import { renderWithApp } from '../render'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function repo(name: string, extra: Partial<RepoDto> = {}): RepoDto {
  return {
    owner: 'acme',
    name,
    defaultBranch: 'main',
    private: false,
    favorite: false,
    lastOpenedAt: null,
    ownerAvatarUrl: null,
    format: null,
    formatPending: false,
    ...extra,
  }
}

const favoriteOf = (client: QueryClient, name: string) =>
  client
    .getQueryData<RepoListResponse>(['repos'])
    ?.repos.find((candidate) => candidate.name === name)?.favorite

function Harness({ onReady }: { onReady: (toggle: ReturnType<typeof useFavoriteToggle>) => void }) {
  useRepoList()
  onReady(useFavoriteToggle())
  return null
}

describe('useFavoriteToggle', () => {
  it('sets the star before the answer and restores it on a 409 with the limit toast', async () => {
    let release: (response: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: RequestInit) => {
        if (init?.method === 'PUT')
          return new Promise<Response>((resolve) => {
            release = resolve
          })
        return Response.json({ repos: [repo('shop')] })
      }),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let toggle: ReturnType<typeof useFavoriteToggle> | undefined
    renderWithApp(<Harness onReady={(value) => (toggle = value)} />, client)
    await waitFor(() => expect(favoriteOf(client, 'shop')).toBe(false))

    act(() => toggle?.mutate({ repo: { owner: 'acme', name: 'shop' }, favorite: true }))
    await waitFor(() => expect(favoriteOf(client, 'shop')).toBe(true))

    release(
      Response.json(
        { error: { code: 'too-many-favorites', message: 'x', details: { max: 100 } } },
        { status: 409 },
      ),
    )
    await waitFor(() => expect(favoriteOf(client, 'shop')).toBe(false))
    expect(await screen.findByText('At most 100 favourites.')).toBeTruthy()
  })
})

describe('useRepoFormatPolling', () => {
  function setup(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    })
    client.setQueryData<RepoListResponse>(['repos'], {
      repos: [repo('shop', { formatPending: true }), repo('blog')],
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    return renderHook(
      () => {
        const list = useRepoList()
        useRepoFormatPolling(list.data?.repos)
        return list.data?.repos
      },
      { wrapper },
    )
  }
  const formatCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.filter(([path]) => path === apiPaths.repoFormats).length

  it('polls every 3 s, merges the formats, and stops once nothing is pending', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () =>
      Response.json({
        formats: [
          {
            owner: 'acme',
            name: 'shop',
            format: { kind: 'prisma', checkedAt: '2026-01-01T00:00:00Z' },
            formatPending: false,
          },
        ],
      }),
    )
    const { result } = setup(fetchMock)

    await act(() => vi.advanceTimersByTimeAsync(2900))
    expect(formatCalls(fetchMock)).toBe(0)
    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(formatCalls(fetchMock)).toBe(1)
    expect(result.current?.find((r) => r.name === 'shop')).toMatchObject({
      format: { kind: 'prisma' },
      formatPending: false,
    })
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(formatCalls(fetchMock)).toBe(1)
  })

  it('gives up after 60 s while repositories stay pending', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () =>
      Response.json({
        formats: [{ owner: 'acme', name: 'shop', format: null, formatPending: true }],
      }),
    )
    setup(fetchMock)
    await act(() => vi.advanceTimersByTimeAsync(120_000))
    expect(formatCalls(fetchMock)).toBe(20)
  })
})

describe('useSchemaOnly', () => {
  it('defaults to on and remembers the choice', () => {
    const { result } = renderHook(() => useSchemaOnly())
    expect(result.current[0]).toBe(true)
    act(() => result.current[1](false))
    expect(result.current[0]).toBe(false)
    expect(window.localStorage.getItem('repoerd:repos:schema-only')).toBe('false')
    expect(renderHook(() => useSchemaOnly()).result.current[0]).toBe(false)
  })

  it('defaults to on when storage throws, and still toggles for the session', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useSchemaOnly())
    expect(result.current[0]).toBe(true)
    act(() => result.current[1](false))
    expect(result.current[0]).toBe(false)
  })
})
