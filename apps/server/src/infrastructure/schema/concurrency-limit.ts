import { ParseQueueFullError } from '../../application/ports/schema-toolkit.js'

/**
 * Runs at most `max` tasks at once; the others wait in arrival order, at most `maxWaiting` of
 * them: beyond, `run` throws ParseQueueFullError without running the task.
 */
export function createConcurrencyLimit(max: number, maxWaiting = Number.POSITIVE_INFINITY) {
  let active = 0
  const waiting: Array<() => void> = []
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) {
      if (waiting.length >= maxWaiting) throw new ParseQueueFullError()
      // The releasing task hands its slot over: `active` stays unchanged.
      await new Promise<void>((resolve) => waiting.push(resolve))
    } else {
      active += 1
    }
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active -= 1
    }
  }
}
