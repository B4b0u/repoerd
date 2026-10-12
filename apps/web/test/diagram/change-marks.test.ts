import { describe, expect, it } from 'vitest'
import { changeOf, MARK, TONE } from '../../src/features/diagram/model/change-marks'

describe('change marks', () => {
  it('gives every change a symbol and a colour, and none to an unchanged item', () => {
    expect(MARK).toEqual({ added: '+', removed: '−', modified: '~' })
    expect(TONE.removed).toBe('text-diff-removed')
    expect(changeOf('modified')).toBe('modified')
    expect(changeOf('unchanged')).toBeUndefined()
    expect(changeOf(undefined)).toBeUndefined()
  })
})
