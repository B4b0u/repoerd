import { MUTATION_HEADER } from '@repoerd/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiPost, apiSend, apiSendJson } from '../../src/shared/api/client'

afterEach(() => vi.unstubAllGlobals())

describe('apiPost', () => {
  it('sends JSON with the mutation header and returns the JSON answer', async () => {
    const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) =>
      Response.json({ postUrl: 'https://github.com/x' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(await apiPost('/api/setup/manifest', { publicUrl: 'https://erd.example.com' })).toEqual({
      postUrl: 'https://github.com/x',
    })
    const [path, init] = fetchMock.mock.calls[0] ?? []
    expect(path).toBe('/api/setup/manifest')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string> | undefined)?.[MUTATION_HEADER]).toBe('1')
    expect(init?.body).toBe('{"publicUrl":"https://erd.example.com"}')
  })

  it('throws an ApiError with the server code and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'forbidden', message: 'Enter the setup code first' } },
          { status: 403 },
        ),
      ),
    )
    await expect(apiPost('/api/setup/manifest', {})).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
      message: 'Enter the setup code first',
    })
  })

  it('keeps the details of an API error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: 'bad_request',
              message: 'Two sources are named "core"',
              details: { reason: 'duplicate-name', name: 'core' },
            },
          },
          { status: 400 },
        ),
      ),
    )
    await expect(apiPost('/api/x', {})).rejects.toMatchObject({
      code: 'bad_request',
      details: { reason: 'duplicate-name', name: 'core' },
    })
  })
})

describe('apiSendJson', () => {
  it('sends the method, the body and the mutation header, and returns the JSON answer', async () => {
    const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) => Response.json({ ok: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await apiSendJson('PUT', '/api/x', { a: 1 })).toEqual({ ok: 1 })
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.method).toBe('PUT')
    expect(init?.body).toBe('{"a":1}')
    expect((init?.headers as Record<string, string> | undefined)?.[MUTATION_HEADER]).toBe('1')

    await apiSendJson('DELETE', '/api/x')
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBeUndefined()
  })
})

describe('apiSend keepalive', () => {
  const stub = () => {
    const fetchMock = vi.fn(
      async (_path: string, _init?: RequestInit) => new Response(null, { status: 204 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('asks for keepalive when requested and the body is small', async () => {
    const fetchMock = stub()
    await apiSend('PATCH', '/x', { a: 1 }, { keepalive: true })
    expect(fetchMock.mock.calls[0]?.[1]?.keepalive).toBe(true)
  })

  it('does not use keepalive by default', async () => {
    const fetchMock = stub()
    await apiSend('PATCH', '/x', { a: 1 })
    expect(fetchMock.mock.calls[0]?.[1]?.keepalive).toBeFalsy()
  })

  it('still sends a body over the keepalive limit, without keepalive', async () => {
    const fetchMock = stub()
    await apiSend('PATCH', '/x', { big: 'x'.repeat(60_001) }, { keepalive: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.keepalive).toBeFalsy()
  })
})

describe('apiSend keepalive cap in bytes', () => {
  const stub = () => {
    const fetchMock = vi.fn(
      async (_path: string, _init?: RequestInit) => new Response(null, { status: 204 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('drops keepalive for a multi-byte body under the character cap but over the byte cap', async () => {
    const fetchMock = stub()
    await apiSend('PATCH', '/x', { name: '表'.repeat(25_000) }, { keepalive: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.keepalive).toBeFalsy()
  })

  it('keeps keepalive for a small multi-byte body', async () => {
    const fetchMock = stub()
    await apiSend('PATCH', '/x', { name: '表'.repeat(100) }, { keepalive: true })
    expect(fetchMock.mock.calls[0]?.[1]?.keepalive).toBe(true)
  })
})
