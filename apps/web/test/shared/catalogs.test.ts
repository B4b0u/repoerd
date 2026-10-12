import { describe, expect, it } from 'vitest'
import { en } from '../../src/shared/i18n/locales/en'
import { fr } from '../../src/shared/i18n/locales/fr'

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value }
  return Object.assign(
    {},
    ...Object.entries(value as Record<string, unknown>).map(([key, child]) =>
      flatten(child, prefix ? `${prefix}.${key}` : key),
    ),
  )
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{(\w+)\}\}|<(\w+)>/g)].map((match) => match[1] ?? match[2]).sort()

/** Keys whose French text is the English one on purpose (names, symbols, shared words). */
const SAME_IN_BOTH = new Set([
  'admin.title',
  'admin.app.title',
  'common.language.en',
  'common.language.fr',
  'common.userMenu.admin',
  'common.formats.prisma',
  'common.formats.drizzle',
  'diagram.toolbar.sources',
  'setup.steps.register-app',
  'setup.registerApp.app',
  'setup.registerApp.clientId',
  'setup.registerApp.organizationName',
  'settings.source',
  'settings.format',
  'tables.title',
  'detail.traits.unique',
  'detail.constraintKinds.unique',
  'compare.panel.tables',
  'compare.fields.type',
  'compare.fields.isUnique',
  'compare.fields.unique',
  'compare.fields.onDelete',
  'compare.fields.onUpdate',
])

const english = flatten(en)
const french = flatten(fr)

describe('catalogues', () => {
  it('have the same keys in both languages', () => {
    expect(Object.keys(french).sort()).toEqual(Object.keys(english).sort())
  })

  it('use the same placeholders and tags in both languages', () => {
    for (const [key, text] of Object.entries(english)) {
      expect([key, placeholders(french[key] ?? '')]).toEqual([key, placeholders(text)])
    }
  })

  it('translate every text', () => {
    const untranslated = Object.keys(english).filter(
      (key) => english[key] === french[key] && !SAME_IN_BOTH.has(key),
    )
    expect(untranslated).toEqual([])
  })
})
