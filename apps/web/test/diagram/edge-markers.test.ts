import { describe, expect, it } from 'vitest'
import { edgeMarkers, MARKER_IDS } from '../../src/features/diagram/edge-markers'

describe('edgeMarkers', () => {
  it('draws "one" on the parent side and "many" on the child side of a one-to-many relationship', () => {
    expect(edgeMarkers('ONE_TO_MANY')).toEqual({
      start: `url(#${MARKER_IDS.one})`,
      end: `url(#${MARKER_IDS.many})`,
    })
  })

  it('draws "one" on both sides of a one-to-one relationship', () => {
    expect(edgeMarkers('ONE_TO_ONE')).toEqual({
      start: `url(#${MARKER_IDS.one})`,
      end: `url(#${MARKER_IDS.one})`,
    })
  })
})
