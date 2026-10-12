// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

/** A fresh i18n module, so detection runs again with the browser and storage of the test. */
async function loadI18n() {
  vi.resetModules()
  return import('../../src/shared/i18n/i18n')
}

const browserLanguages = (languages: string[]) =>
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages)

afterEach(() => vi.restoreAllMocks())

describe('language detection', () => {
  it.each([
    [['fr-FR', 'fr'], 'fr'],
    [['fr-CA'], 'fr'],
    [['de-DE', 'de'], 'en'],
    [['en-GB'], 'en'],
  ])('follows a browser speaking %j when nothing was chosen', async (languages, expected) => {
    browserLanguages(languages)
    const { i18n } = await loadI18n()
    expect(i18n.resolvedLanguage).toBe(expected)
    expect(document.documentElement.lang).toBe(expected)
  })

  it('prefers the stored choice over the browser', async () => {
    browserLanguages(['fr-FR'])
    window.localStorage.setItem('repoerd:lang', 'en')
    const { i18n } = await loadI18n()
    expect(i18n.resolvedLanguage).toBe('en')
  })

  it('ignores a stored value that is not a supported language', async () => {
    browserLanguages(['fr-FR'])
    window.localStorage.setItem('repoerd:lang', 'xx')
    const { i18n } = await loadI18n()
    expect(i18n.resolvedLanguage).toBe('fr')
  })

  it('does not store the detected language', async () => {
    browserLanguages(['fr-FR'])
    await loadI18n()
    expect(window.localStorage.getItem('repoerd:lang')).toBeNull()
  })
})

describe('setLanguage', () => {
  it('switches the interface and remembers the choice', async () => {
    browserLanguages(['en-US'])
    const { i18n, setLanguage } = await loadI18n()
    await setLanguage('fr')
    expect(i18n.resolvedLanguage).toBe('fr')
    expect(window.localStorage.getItem('repoerd:lang')).toBe('fr')
    expect(document.documentElement.lang).toBe('fr')
  })
})

describe('plurals', () => {
  it('follow the rules of each language', async () => {
    const { i18n } = await loadI18n()
    expect(i18n.getFixedT('en', 'repos')('count', { count: 0 })).toBe('0 repositories')
    expect(i18n.getFixedT('en', 'repos')('count', { count: 1 })).toBe('1 repository')
    expect(i18n.getFixedT('fr', 'repos')('count', { count: 0 })).toBe('0 dépôt')
    expect(i18n.getFixedT('fr', 'repos')('count', { count: 2 })).toBe('2 dépôts')
  })
})
