import { describe, expect, it } from 'vitest'
import { replaceAppErrorMessage } from '../../src/features/admin/replace-app-error'
import { i18n } from '../../src/shared/i18n/i18n'

describe('replaceAppErrorMessage', () => {
  it('explains each code GitHub’s replacement callback sends back, in both languages', () => {
    expect(replaceAppErrorMessage(i18n.getFixedT('en', 'admin'), 'state')).toContain('another tab')
    expect(replaceAppErrorMessage(i18n.getFixedT('en', 'admin'), 'forbidden')).toContain(
      'administrator',
    )
    expect(replaceAppErrorMessage(i18n.getFixedT('fr', 'admin'), 'github')).toContain(
      'GitHub est injoignable',
    )
  })

  it('falls back to a generic message for anything else', () => {
    for (const code of ['nope', 'constructor', '__proto__', 'unknown']) {
      expect(replaceAppErrorMessage(i18n.getFixedT('en', 'admin'), code)).toBe(
        'Something went wrong. Start again.',
      )
    }
  })
})
