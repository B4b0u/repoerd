import type { TablePosition } from '@repoerd/model'

/** A save that has not answered after this long counts as failed (re-queued, then retried). */
export const SAVE_TIMEOUT_MS = 20_000

/** Retries of a failed save: after 1 s, 5 s and 15 s; then with the next move or "Retry". */
export const SAVE_RETRY_DELAYS_MS: readonly number[] = [1000, 5000, 15_000]

/**
 * What a send answers: true once saved, or when retrying makes no sense (a sign-in is under way);
 * false when it failed; `{ retryAfterMs }` when the server asked to wait (429 `retry-after`);
 * `{ permanent: true }` when the server refused it for good (a 4xx): resending it is pointless.
 */
export type SendResult = boolean | { retryAfterMs: number } | { permanent: true }

export type SendPositions = (
  positions: TablePosition[],
  options?: { keepalive?: boolean },
) => Promise<SendResult>

export interface PositionBatcher {
  /** A dragged table: sent after the debounce, with the other pending ones. */
  add(position: TablePosition): void
  /** Positions to save at once (auto-placement, "Rearrange all"), with the pending ones. */
  addAll(positions: readonly TablePosition[]): Promise<void>
  flush(options?: { keepalive?: boolean }): Promise<void>
  /** Sends the positions of the failed saves now ("Retry"). */
  retry(): Promise<void>
  /** Drops the pending positions without sending them. */
  cancel(): void
  /** Stops the automatic retries (the canvas unmounts). */
  dispose(): void
  /** Re-arms a disposed batcher (StrictMode runs an effect's setup, cleanup, setup again). */
  activate(): void
}

export function createPositionBatcher(
  send: SendPositions,
  options: { delayMs?: number; retryDelaysMs?: readonly number[] } = {},
): PositionBatcher {
  const delayMs = options.delayMs ?? 500
  const retryDelaysMs = options.retryDelaysMs ?? SAVE_RETRY_DELAYS_MS
  // Each position carries the version it was given: a failed batch comes back only for the
  // tables nobody moved since, so a retry never overwrites a newer position.
  const pending = new Map<string, { position: TablePosition; version: number }>()
  const latest = new Map<string, number>()
  let version = 0
  let failures = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  // One send at a time per batcher (= per layout): a PATCH never overtakes an earlier one.
  let inFlight: Promise<unknown> | undefined
  let inFlightBatch: { position: TablePosition; version: number }[] = []
  // The server's retry-after: nothing is sent before this time, drags included.
  let notBefore = 0

  const stop = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  const schedule = (ms: number) => {
    stop()
    timer = setTimeout(() => void flush(), ms)
  }
  const put = (position: TablePosition) => {
    version += 1
    latest.set(position.table, version)
    pending.set(position.table, { position, version })
  }

  /** Sends now, or once the server's retry-after has passed. */
  async function flushWhenAllowed(): Promise<void> {
    const wait = notBefore - Date.now()
    if (wait > 0 && pending.size > 0) schedule(wait)
    else await flush()
  }

  async function flush(flushOptions?: { keepalive?: boolean }): Promise<void> {
    stop()
    if (flushOptions?.keepalive) {
      // The page is going away: no waiting behind a send that may never answer. What is on its
      // way is sent again unless a newer position exists; the newer version wins. Trade-off: this
      // send may overtake an older one still in flight, which could then land last and win on the
      // server; accepted, since waiting for it is exactly what a closing page cannot do.
      // Not limited to pagehide: mobile browsers may never fire it, only visibilitychange.
      for (const entry of inFlightBatch) {
        const table = entry.position.table
        if (latest.get(table) === entry.version && !pending.has(table)) pending.set(table, entry)
      }
    } else {
      while (inFlight) await inFlight
      // The send waited behind may have scheduled a retry: this flush takes its positions.
      stop()
    }
    if (pending.size === 0) return
    const batch = [...pending.values()]
    pending.clear()
    const positions = batch.map((entry) => entry.position)
    const sending = flushOptions ? send(positions, flushOptions) : send(positions)
    const tracked = sending.catch(() => undefined)
    inFlight = tracked
    inFlightBatch = batch
    let result: SendResult
    try {
      result = await sending
    } finally {
      if (inFlight === tracked) {
        inFlight = undefined
        inFlightBatch = []
      }
    }
    if (result === true) {
      failures = 0
      return
    }
    // A refused batch is final: it must not come back and poison the next ones.
    if (typeof result === 'object' && 'permanent' in result) return
    for (const entry of batch) {
      const table = entry.position.table
      if (latest.get(table) === entry.version && !pending.has(table)) pending.set(table, entry)
    }
    if (typeof result === 'object' && 'retryAfterMs' in result) {
      notBefore = Math.max(notBefore, Date.now() + result.retryAfterMs)
    }
    const delay = retryDelaysMs[failures]
    failures += 1
    // A move made meanwhile already scheduled its own send, which carries these positions too.
    if (delay !== undefined && !disposed && !timer && pending.size > 0) {
      schedule(Math.max(delay, notBefore - Date.now()))
    }
  }

  return {
    add(position) {
      put(position)
      schedule(Math.max(delayMs, notBefore - Date.now()))
    },
    async addAll(positions) {
      for (const position of positions) put(position)
      await flushWhenAllowed()
    },
    flush,
    retry: () => flushWhenAllowed(),
    cancel() {
      pending.clear()
      stop()
    },
    dispose() {
      disposed = true
      stop()
    },
    activate() {
      disposed = false
    },
  }
}
