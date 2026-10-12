import type { TFunction } from 'i18next'
import { en } from '../../shared/i18n/locales/en'

type ReplaceAppError = Exclude<keyof typeof en.admin.replaceApp.errors, 'unknown'>

const isReplaceAppError = (code: string): code is ReplaceAppError =>
  code !== 'unknown' && Object.hasOwn(en.admin.replaceApp.errors, code)

/** Messages for the `?error=` GitHub's replacement callback sends the administrator back with. */
export function replaceAppErrorMessage(t: TFunction<'admin'>, code: string): string {
  return isReplaceAppError(code) ? t(`replaceApp.errors.${code}`) : t('replaceApp.errors.unknown')
}
