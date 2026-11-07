import { describe, expect, it } from 'vitest'
import { i18n } from '../../src/shared/i18n/i18n'
import { en } from '../../src/shared/i18n/locales/en'

describe('the texts of the groups', () => {
  it('are not in the initial catalogues (first-page weight)', () => {
    expect(Object.keys(en)).not.toContain('groups')
  })

  it('are registered in both languages by the diagram chunk', async () => {
    await import('../../src/features/diagram/groups/groups-i18n')
    expect(i18n.getFixedT('en', 'groups')('undo')).toBe('Undo')
    expect(i18n.getFixedT('fr', 'groups')('undo')).toBe('Annuler')
  })
})
