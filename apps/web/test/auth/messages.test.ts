import { describe, expect, it } from 'vitest'
import { signInErrorMessage } from '../../src/features/auth/messages'
import { i18n } from '../../src/shared/i18n/i18n'

describe('signInErrorMessage', () => {
  it.each([
    ['denied', 'cancelled'],
    ['state', 'Try again'],
    ['invalid-code', 'GitHub refused'],
    ['org-not-allowed', 'organisation'],
    ['not-configured', 'not configured'],
    ['github', 'GitHub could not be reached or refused the request. Try again in a few minutes.'],
    ['anything', 'Sign-in failed'],
  ])('explains %s', (code, expected) => {
    expect(signInErrorMessage(i18n.getFixedT('en', 'auth'), code)).toContain(expected)
  })

  it('speaks French', () => {
    expect(signInErrorMessage(i18n.getFixedT('fr', 'auth'), 'denied')).toBe(
      'La connexion a été annulée sur GitHub.',
    )
    expect(signInErrorMessage(i18n.getFixedT('fr', 'auth'), 'anything')).toBe(
      'La connexion a échoué. Réessayez.',
    )
  })
})
