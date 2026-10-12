import { describe, expect, it } from 'vitest'
import { ParseQueueFullError } from '../../src/application/ports/schema-toolkit.js'
import { createConcurrencyLimit } from '../../src/infrastructure/schema/concurrency-limit.js'

describe('createConcurrencyLimit', () => {
  it('never runs more than the limit at once and runs everything', async () => {
    const run = createConcurrencyLimit(2)
    let active = 0
    let peak = 0
    const task = (value: number) => () =>
      new Promise<number>((resolve) => {
        active += 1
        peak = Math.max(peak, active)
        setTimeout(() => {
          active -= 1
          resolve(value)
        }, 5)
      })
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => run(task(n))))
    expect(results).toEqual([1, 2, 3, 4, 5])
    expect(peak).toBe(2)
  })

  it('refuses a task when too many are already waiting, and accepts it once room is made', async () => {
    const run = createConcurrencyLimit(1, 2)
    let finish = () => {}
    const blocker = run(
      () =>
        new Promise<string>((resolve) => {
          finish = () => resolve('first')
        }),
    )
    const waiting = [run(async () => 'second'), run(async () => 'third')]
    await expect(run(async () => 'fourth')).rejects.toBeInstanceOf(ParseQueueFullError)
    finish()
    expect(await Promise.all([blocker, ...waiting])).toEqual(['first', 'second', 'third'])
    expect(await run(async () => 'fifth')).toBe('fifth')
  })

  it('frees the slot when a task fails', async () => {
    const run = createConcurrencyLimit(1)
    await expect(run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(await run(async () => 'next')).toBe('next')
  })

  it('hands a freed slot to the next waiter even if a new task arrives in the meantime', async () => {
    const run = createConcurrencyLimit(1)
    let active = 0
    let peak = 0
    const order: string[] = []
    const track = (name: string, wait: Promise<void>) => async () => {
      active += 1
      peak = Math.max(peak, active)
      order.push(name)
      await wait
      active -= 1
      return name
    }
    let finishA = () => {}
    const aDone = new Promise<void>((resolve) => {
      finishA = resolve
    })
    let taskA: Promise<string> = Promise.resolve('')
    const a = run(() => {
      taskA = track('A', aDone)()
      return taskA
    })
    const b = run(track('B', Promise.resolve()))
    let c: Promise<string> = Promise.resolve('')
    // Registered after run()'s own continuation: fires right after the slot is released,
    // before the woken waiter resumes.
    taskA.then(() => {
      c = run(track('C', Promise.resolve()))
    })
    finishA()
    await Promise.all([a, b])
    await c
    expect(peak).toBe(1)
    expect(order).toEqual(['A', 'B', 'C'])
  })
})
