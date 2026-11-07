import { describe, expect, it } from 'vitest'
import {
  cardNameSize,
  GROUP_LABEL,
  type MeasureText,
  overviewLabels,
  type Rect,
} from '../../src/features/diagram/overview-labels'

// Every character 0.5em wide.
const measure: MeasureText = (text, fontSize) => text.length * fontSize * 0.5
const frame = (x: number, y: number, width = 400, height = 300): Rect => ({ x, y, width, height })
const card = (x: number, y: number): Rect => ({ x, y, width: 280, height: 200 })
const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('the group names of the overview', () => {
  it('keeps every name when the frames are far apart', () => {
    const labels = overviewLabels(
      0.2,
      [
        { id: 'a', name: 'billing', frame: frame(0, 0) },
        { id: 'b', name: 'users', frame: frame(0, 2000) },
      ],
      [],
      measure,
    )
    expect([...labels.crowdedGroups]).toEqual([])
  })

  it('leaves out the smaller of two frames whose names would overlap', () => {
    const labels = overviewLabels(
      0.05,
      [
        { id: 'small', name: 'drizzle-entity-002', frame: frame(0, 100, 300, 200) },
        { id: 'large', name: 'drizzle-entity-001', frame: frame(0, 0, 300, 600) },
      ],
      [],
      measure,
    )
    expect([...labels.crowdedGroups]).toEqual(['small'])
  })

  it('brings the names back as the user zooms in', () => {
    const groups = Array.from({ length: 20 }, (_, i) => ({
      id: `g${i}`,
      name: `drizzle-entity-${i}`,
      frame: frame(0, i * 400),
    }))
    const far = overviewLabels(0.05, groups, [], measure).crowdedGroups.size
    const nearer = overviewLabels(0.25, groups, [], measure).crowdedGroups.size
    expect(far).toBeGreaterThan(nearer)
    expect(nearer).toBe(0)
  })

  it('never lets two kept names overlap, at any zoom', () => {
    const groups = Array.from({ length: 100 }, (_, i) => ({
      id: `g${i}`,
      name: `drizzle-entity-${String(i).padStart(3, '0')}`,
      frame: frame((i % 3) * 350, Math.floor(i / 3) * 260, 320, 240),
    }))
    for (const zoom of [0.02, 0.05, 0.1, 0.2, 0.29]) {
      const { crowdedGroups } = overviewLabels(zoom, groups, [], measure)
      const kept = groups.filter((g) => !crowdedGroups.has(g.id))
      expect(kept.length).toBeGreaterThan(0)
      const height = (GROUP_LABEL.fontSize * GROUP_LABEL.lineHeight + 2 * GROUP_LABEL.padY) / zoom
      const rects = kept.map((g) => ({
        x: g.frame.x + GROUP_LABEL.inset / zoom,
        y: g.frame.y - GROUP_LABEL.lift / zoom - height,
        width: Math.min(measure(g.name, 14, 600) + 18, Math.max(320 * zoom - 24, 320)) / zoom,
        height,
      }))
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          expect(overlap(rects[i] as Rect, rects[j] as Rect), `${zoom}: ${i} ${j}`).toBe(false)
        }
      }
    }
  })
})

describe('the table names of the overview', () => {
  it('reads a name on its card while it is large enough', () => {
    // 280 px card at 25 %: 70 px on screen, 10 characters → about 10 px.
    expect(cardNameSize(280, 10, 0.25)).toBeGreaterThanOrEqual(9)
    expect(cardNameSize(280, 10, 0.07)).toBeLessThan(9)
    expect(cardNameSize(280, 2, 0.29)).toBe(14)
  })

  it('floats the unreadable names over their cards, without overlaps', () => {
    const tables = Array.from({ length: 30 }, (_, i) => ({
      id: `entity_${i}`,
      name: `entity_${String(i).padStart(3, '0')}`,
      card: card(0, i * 230),
      degree: i === 7 ? 10 : 1,
    }))
    const labels = overviewLabels(0.05, [], tables, measure)
    expect(labels.unreadable.size).toBe(30)
    expect(labels.floating.size).toBeGreaterThan(0)
    expect(labels.floating.size).toBeLessThan(30)
    // The most connected table keeps its name.
    expect(labels.floating.has('entity_7')).toBe(true)
    const rects = [...labels.floating.values()]
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlap(rects[i] as Rect, rects[j] as Rect)).toBe(false)
      }
    }
  })

  it('floats no name while the cards can show theirs', () => {
    const tables = [{ id: 'users', name: 'users', card: card(0, 0), degree: 0 }]
    const labels = overviewLabels(0.25, [], tables, measure)
    expect(labels.unreadable.size).toBe(0)
    expect(labels.floating.size).toBe(0)
  })

  it('gives way to the group names', () => {
    const labels = overviewLabels(
      0.05,
      [{ id: 'g', name: 'billing-and-invoices', frame: frame(0, 300, 300, 300) }],
      // The card sits right under the group name.
      [{ id: 'invoices', name: 'invoices', card: card(0, -100), degree: 5 }],
      measure,
    )
    expect(labels.crowdedGroups.size).toBe(0)
    expect(labels.floating.has('invoices')).toBe(false)
  })
})
