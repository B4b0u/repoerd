import { describe, expect, it } from 'vitest'
import {
  type Box,
  classifyMembers,
  FRAME_PADDING,
  groupFrames,
  LABEL_SPACE,
} from '../../src/features/diagram/groups/group-frames'
import type { GroupView } from '../../src/features/diagram/groups/group-view'

const box = (id: string, x: number, y: number): Box => ({ id, x, y, width: 200, height: 100 })

const viewOf = (membership: Record<string, string | null>): GroupView => ({
  proposed: false,
  groups: [{ id: 'g', name: 'G', color: '#000', origins: [] }],
  membership: new Map(Object.entries(membership)),
  canEdit: false,
  loading: false,
})

describe('classifyMembers', () => {
  const boxes = [
    box('a', 0, 0),
    box('b', 300, 0),
    box('c', 0, 200),
    box('d', 300, 200),
    box('far', 3000, 0),
  ]
  const view = viewOf({ a: 'g', b: 'g', c: 'g', d: 'g', far: 'g' })

  it('puts a table 3000 px away in the outliers', () => {
    const { clusters, outliers } = classifyMembers(boxes, view)
    expect(clusters.get('g')).toEqual(['a', 'b', 'c', 'd'])
    expect([...outliers]).toEqual(['far'])
  })

  it('never reports outliers in a group of two tables', () => {
    const { clusters, outliers } = classifyMembers(
      [box('a', 0, 0), box('b', 5000, 0)],
      viewOf({ a: 'g', b: 'g' }),
    )
    expect(clusters.get('g')).toEqual(['a', 'b'])
    expect(outliers.size).toBe(0)
  })

  it('ignores tables outside any group', () => {
    const { clusters, outliers } = classifyMembers(
      [box('a', 0, 0), box('x', 10, 10), box('y', 20, 20)],
      viewOf({ a: 'g', x: null }),
    )
    expect(clusters.get('g')).toEqual(['a'])
    expect([...clusters.keys()]).toEqual(['g'])
    expect(outliers.size).toBe(0)
  })

  it('has no cluster for a group without visible table', () => {
    const { clusters } = classifyMembers([box('a', 0, 0)], viewOf({ a: null, hidden: 'g' }))
    expect(clusters.size).toBe(0)
  })
})

describe('groupFrames', () => {
  it('wraps the cluster with padding and label space', () => {
    const boxes = [box('a', 0, 0), box('b', 300, 200), box('far', 3000, 0)]
    const frames = groupFrames(boxes, new Map([['g', ['a', 'b']]]))
    expect(frames).toEqual([
      {
        groupId: 'g',
        x: -FRAME_PADDING,
        y: -FRAME_PADDING - LABEL_SPACE,
        width: 500 + 2 * FRAME_PADDING,
        height: 300 + 2 * FRAME_PADDING + LABEL_SPACE,
        members: ['a', 'b'],
      },
    ])
  })

  it('draws no frame for an empty cluster', () => {
    expect(groupFrames([box('a', 0, 0)], new Map([['g', []]]))).toEqual([])
  })
})
