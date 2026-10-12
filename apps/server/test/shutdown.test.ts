import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeShutdown } from '../src/shutdown.js'

function world(closeBehaviour: 'closes' | 'fails' | 'hangs' = 'closes') {
  const events: string[] = []
  const deps = {
    server: {
      close(callback: (error?: Error) => void) {
        events.push('server.close')
        if (closeBehaviour === 'closes') setTimeout(() => callback(), 5)
        if (closeBehaviour === 'fails') setTimeout(() => callback(new Error('not running')), 5)
      },
    },
    closeParsers: () => events.push('parsers.close'),
    closeDatabase: () => events.push('database.close'),
    logger: { info: () => {}, error: () => {} },
    exit: (code: number) => events.push(`exit ${code}`),
  }
  return { events, shutdown: makeShutdown(deps) }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('makeShutdown', () => {
  it('closes the HTTP server, then the database, then exits with 0', async () => {
    vi.useFakeTimers()
    const { events, shutdown } = world()
    shutdown('SIGTERM')
    expect(events).toEqual(['server.close'])
    await vi.advanceTimersByTimeAsync(5)
    expect(events).toEqual(['server.close', 'parsers.close', 'database.close', 'exit 0'])
  })

  it('ignores a second signal', async () => {
    vi.useFakeTimers()
    const { events, shutdown } = world()
    shutdown('SIGTERM')
    shutdown('SIGINT')
    await vi.advanceTimersByTimeAsync(5)
    expect(events).toEqual(['server.close', 'parsers.close', 'database.close', 'exit 0'])
  })

  it('still closes the database when the server closes with an error, and exits with 1', async () => {
    vi.useFakeTimers()
    const { events, shutdown } = world('fails')
    shutdown('SIGTERM')
    await vi.advanceTimersByTimeAsync(5)
    expect(events).toEqual(['server.close', 'parsers.close', 'database.close', 'exit 1'])
  })

  it('exits with 1 after 8 seconds when requests never finish', async () => {
    vi.useFakeTimers()
    const { events, shutdown } = world('hangs')
    shutdown('SIGTERM')
    await vi.advanceTimersByTimeAsync(7_999)
    expect(events).toEqual(['server.close'])
    await vi.advanceTimersByTimeAsync(1)
    expect(events).toEqual(['server.close', 'exit 1'])
  })
})
