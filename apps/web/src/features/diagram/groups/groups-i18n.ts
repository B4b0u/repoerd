import { useTranslation } from 'react-i18next'
import { i18n } from '../../../shared/i18n/i18n'
import { groups as en } from '../../../shared/i18n/locales/en/groups'
import { groups as fr } from '../../../shared/i18n/locales/fr/groups'

// The groups' texts stay out of the first page: registered when the diagram's chunk loads.
i18n.addResourceBundle('en', 'groups', en, true, true)
i18n.addResourceBundle('fr', 'groups', fr, true, true)

/** `useTranslation('groups')`, with the guarantee that the texts are registered. */
export const useGroupsTranslation = () => useTranslation('groups')
