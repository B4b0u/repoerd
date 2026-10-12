import { describe, expect, it } from 'vitest'
import { manualSourceId } from '../src/index.js'

describe('manualSourceId', () => {
  it('prefixes the name so manual ids never collide with detected paths', () => {
    expect(manualSourceId('Core schema')).toBe('manual:Core schema')
  })
})
