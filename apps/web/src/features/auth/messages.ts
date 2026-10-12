import type { TFunction } from 'i18next'
import { en } from '../../shared/i18n/locales/en'

type SignInError = Exclude<keyof typeof en.auth.errors, 'unknown'>

const isSignInError = (code: string): code is SignInError =>
  code !== 'unknown' && Object.hasOwn(en.auth.errors, code)

/** Messages for the `?error=` the sign-in callback redirects with. */
export function signInErrorMessage(t: TFunction<'auth'>, code: string): string {
  return isSignInError(code) ? t(`errors.${code}`) : t('errors.unknown')
}
