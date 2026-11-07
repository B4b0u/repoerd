import { describe, expect, it } from 'vitest'
import { shifted } from '../../src/features/diagram/groups/use-group-move'

describe('moving a group by its label', () => {
  it('shifts every table by the pointer travel, in canvas units', () => {
    const starts = new Map([
      ['invoices', { x: 0, y: 0 }],
      ['payments', { x: 300, y: 120 }],
    ])
    // 50 px on screen at 50 % zoom: 100 canvas units.
    expect(shifted(starts, { x: 50, y: -25 }, 0.5)).toEqual(
      new Map([
        ['invoices', { x: 100, y: -50 }],
        ['payments', { x: 400, y: 70 }],
      ]),
    )
  })

  it('leaves the starting positions as they were (Escape puts them back)', () => {
    const starts = new Map([['users', { x: 10, y: 20 }]])
    shifted(starts, { x: 5, y: 5 }, 1)
    expect(starts.get('users')).toEqual({ x: 10, y: 20 })
  })
})
