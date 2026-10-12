import type { Relationship } from '@repoerd/model'

export const MARKER_IDS = {
  one: 'repoerd-marker-one',
  many: 'repoerd-marker-many',
} as const

/** Crow's foot notation: a bar for "one", a fork for "many". The parent side is always "one". */
export function edgeMarkers(cardinality: Relationship['cardinality']): {
  start: string
  end: string
} {
  return {
    start: `url(#${MARKER_IDS.one})`,
    end: `url(#${cardinality === 'ONE_TO_MANY' ? MARKER_IDS.many : MARKER_IDS.one})`,
  }
}
