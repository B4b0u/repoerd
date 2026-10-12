import i18next from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { en } from './locales/en'
import { fr } from './locales/fr'

export const LANGUAGES = ['en', 'fr'] as const
export type Language = (typeof LANGUAGES)[number]

/** Only an explicit choice is stored: otherwise the browser language is detected on every visit. */
export const LANGUAGE_STORAGE_KEY = 'repoerd:lang'

export const isLanguage = (value: string): value is Language =>
  (LANGUAGES as readonly string[]).includes(value)

/** French for any `fr` variant, English otherwise. */
export const toLanguage = (value: string | undefined): Language =>
  value?.split('-')[0] === 'fr' ? 'fr' : 'en'

export const i18n = i18next.createInstance()

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en, fr },
    fallbackLng: 'en',
    supportedLngs: [...LANGUAGES],
    load: 'languageOnly',
    ns: Object.keys(en),
    defaultNS: 'common',
    // React escapes what it renders.
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: [],
    },
    // The catalogues are bundled: initialise synchronously, before the first render.
    initAsync: false,
  })

function syncDocumentLanguage(language: string | undefined) {
  if (typeof document !== 'undefined') document.documentElement.lang = toLanguage(language)
}
i18n.on('languageChanged', syncDocumentLanguage)
syncDocumentLanguage(i18n.resolvedLanguage)

export async function setLanguage(language: Language): Promise<void> {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Storage may be unavailable (private mode); the language still applies for this session.
  }
  await i18n.changeLanguage(language)
}
