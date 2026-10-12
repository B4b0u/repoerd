import type { TablePosition } from '@repoerd/model'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPositionBatcher,
  SAVE_RETRY_DELAYS_MS,
} from '../../src/features/diagram/layout/position-batcher'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

const saved = () => vi.fn(async (_positions: TablePosition[], _options?: object) => true)

describe('createPositionBatcher', () => {
  it('sends one batch after the delay, keeping the last position of each table', async () => {
    const send = saved()
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'users', x: 1, y: 1 })
    batcher.add({ table: 'posts', x: 2, y: 2 })
    batcher.add({ table: 'users', x: 3, y: 3 })

    await vi.advanceTimersByTimeAsync(499)
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith([
      { table: 'users', x: 3, y: 3 },
      { table: 'posts', x: 2, y: 2 },
    ])
  })

  it('flushes immediately on demand and does nothing when empty', async () => {
    const send = saved()
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    await batcher.flush()
    expect(send).not.toHaveBeenCalled()

    batcher.add({ table: 'users', x: 1, y: 1 })
    await batcher.flush()
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('drops the pending positions on cancel', async () => {
    const send = saved()
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'users', x: 1, y: 1 })
    batcher.cancel()
    await batcher.flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(send).not.toHaveBeenCalled()
  })

  it('passes the flush options to send', async () => {
    const send = saved()
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'users', x: 1, y: 1 })
    await batcher.flush({ keepalive: true })
    expect(send).toHaveBeenCalledWith([{ table: 'users', x: 1, y: 1 }], { keepalive: true })
  })

  it('sends what addAll gets at once, with the drags still pending', async () => {
    const send = saved()
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'users', x: 1, y: 1 })
    await batcher.addAll([{ table: 'posts', x: 2, y: 2 }])
    expect(send).toHaveBeenCalledWith([
      { table: 'users', x: 1, y: 1 },
      { table: 'posts', x: 2, y: 2 },
    ])
  })

  it('retries a failed batch after 1 s, 5 s and 15 s, then with the next move', async () => {
    expect(SAVE_RETRY_DELAYS_MS).toEqual([1000, 5000, 15_000])
    const send = vi.fn(async (_positions: TablePosition[]) => false)
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'users', x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(500)
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(send).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(send).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(4)

    send.mockResolvedValue(true)
    batcher.add({ table: 'posts', x: 2, y: 2 })
    await vi.advanceTimersByTimeAsync(500)
    expect(send).toHaveBeenCalledTimes(5)
    expect(send).toHaveBeenLastCalledWith([
      { table: 'users', x: 1, y: 1 },
      { table: 'posts', x: 2, y: 2 },
    ])
  })

  it('never sends an older position over a newer one when a failed batch comes back', async () => {
    let answer: (saved: boolean) => void = () => {}
    const send = vi.fn(
      (_positions: TablePosition[]) =>
        new Promise<boolean>((resolve) => {
          answer = resolve
        }),
    )
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'users', x: 1, y: 1 })
    batcher.add({ table: 'posts', x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(500)
    // users moves again while its first save is on its way; that save then fails.
    batcher.add({ table: 'users', x: 9, y: 9 })
    answer(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]?.[0]).toEqual([
      { table: 'users', x: 9, y: 9 },
      { table: 'posts', x: 1, y: 1 },
    ])
  })

  it('retries at once on demand, and sends nothing when nothing is left', async () => {
    const send = vi.fn(async (_positions: TablePosition[]) => false)
    const batcher = createPositionBatcher(send, { delayMs: 500, retryDelaysMs: [] })
    batcher.add({ table: 'users', x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)
    send.mockResolvedValue(true)
    await batcher.retry()
    expect(send).toHaveBeenCalledTimes(2)
    await batcher.retry()
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('waits at least the retry-after of a rate-limited save before retrying', async () => {
    const send = vi.fn(
      async (_positions: TablePosition[]): Promise<boolean | { retryAfterMs: number }> => ({
        retryAfterMs: 20_000,
      }),
    )
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'users', x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(19_999)
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('retries again after dispose then activate (StrictMode re-runs the effect)', async () => {
    const send = vi.fn(async (_positions: TablePosition[]) => false)
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.dispose()
    batcher.activate()
    batcher.add({ table: 'users', x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('stops a scheduled retry on dispose', async () => {
    const send = vi.fn(async (_positions: TablePosition[]) => false)
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'users', x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(500)
    batcher.dispose()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('clears a pending retry timer on cancel', async () => {
    const send = vi.fn(async (_positions: TablePosition[]) => false)
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'users', x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(500)
    batcher.cancel()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('starts the retry delays over after a success', async () => {
    const send = vi.fn(async (_positions: TablePosition[]) => false)
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'users', x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(1000) // second failure, next retry in 5 s
    expect(send).toHaveBeenCalledTimes(2)
    send.mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(send).toHaveBeenCalledTimes(3)
    send.mockResolvedValue(false)
    batcher.add({ table: 'posts', x: 2, y: 2 })
    await vi.advanceTimersByTimeAsync(500)
    expect(send).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(1000) // 1 s again, not 5 s
    expect(send).toHaveBeenCalledTimes(5)
  })

  it('does not re-queue a refused batch, and later batches still go through', async () => {
    const send = vi.fn(
      async (_positions: TablePosition[]): Promise<boolean | { permanent: true }> => ({
        permanent: true,
      }),
    )
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'bad', x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)
    send.mockResolvedValue(true)
    batcher.add({ table: 'users', x: 2, y: 2 })
    await vi.advanceTimersByTimeAsync(500)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith([{ table: 'users', x: 2, y: 2 }])
  })

  it('sends one batch at a time: a flush waits for the one in flight', async () => {
    const answers: Array<(saved: boolean) => void> = []
    const send = vi.fn(
      (_positions: TablePosition[]) =>
        new Promise<boolean>((resolve) => {
          answers.push(resolve)
        }),
    )
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'users', x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(500)
    batcher.add({ table: 'posts', x: 2, y: 2 })
    await vi.advanceTimersByTimeAsync(500)
    expect(send).toHaveBeenCalledTimes(1)
    answers[0]?.(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith([{ table: 'posts', x: 2, y: 2 }])
  })

  it('does not send a new drag before the retry-after of the server', async () => {
    const send = vi.fn(
      async (_positions: TablePosition[]): Promise<boolean | { retryAfterMs: number }> => ({
        retryAfterMs: 20_000,
      }),
    )
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'users', x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(500)
    batcher.add({ table: 'posts', x: 2, y: 2 })
    await vi.advanceTimersByTimeAsync(19_000)
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('sends at once on a keepalive flush, even with a send in flight, newest version winning', async () => {
    const send = vi.fn(
      (_positions: TablePosition[], _options?: object) => new Promise<boolean>(() => {}),
    )
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'users', x: 1, y: 1 })
    batcher.add({ table: 'posts', x: 5, y: 5 })
    await vi.advanceTimersByTimeAsync(500)
    batcher.add({ table: 'users', x: 9, y: 9 })
    void batcher.flush({ keepalive: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith(
      [
        { table: 'users', x: 9, y: 9 },
        { table: 'posts', x: 5, y: 5 },
      ],
      { keepalive: true },
    )
  })

  it('takes the positions of a failed send it waited behind, without a second retry', async () => {
    const answers: Array<(saved: boolean) => void> = []
    const send = vi.fn(
      (_positions: TablePosition[]) =>
        new Promise<boolean>((resolve) => {
          answers.push(resolve)
        }),
    )
    const batcher = createPositionBatcher(send, { delayMs: 500 })
    batcher.add({ table: 'users', x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(500)
    const waiting = batcher.flush()
    answers[0]?.(false) // fails: schedules its retry, the waiter takes the positions
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(2)
    answers[1]?.(true)
    await waiting
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(2)
  })
})
