import 'i18next'
import type { en } from './locales/en'
import type { GroupsCatalog } from './locales/en/groups'

// Typed keys: t('unknown.key') and keys missing from the English catalogue fail the typecheck.
// `groups` is registered later, by the diagram's chunk (features/diagram/groups/groups-i18n.ts).
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: typeof en & { groups: GroupsCatalog }
  }
}
