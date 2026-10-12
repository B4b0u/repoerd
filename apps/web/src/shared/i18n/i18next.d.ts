import 'i18next'
import type { en } from './locales/en'

// Typed keys: t('unknown.key') and keys missing from the English catalogue fail the typecheck.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: typeof en
  }
}
