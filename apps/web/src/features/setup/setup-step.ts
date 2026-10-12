import type { SetupStatusResponse } from '@repoerd/contracts'
import type { TFunction } from 'i18next'
import { en } from '../../shared/i18n/locales/en'
import { signInErrorMessage } from '../auth/messages'

export type SetupStep = 'unlock' | 'register-app' | 'become-admin' | 'done'

/** Every step but the last needs the setup grant, which expires after one hour. */
export function setupStep(status: SetupStatusResponse): SetupStep {
  if (status.state === 'ready') return 'done'
  if (!status.unlocked) return 'unlock'
  return status.state === 'needs-app' ? 'register-app' : 'become-admin'
}

type SetupError = Exclude<keyof typeof en.setup.errors, 'unknown'>

const isSetupError = (code: string): code is SetupError =>
  code !== 'unknown' && Object.hasOwn(en.setup.errors, code)

/**
 * Messages for the `?error=` the GitHub callback redirects with, and for the sign-in errors the
 * gate carries as `signin-<code>` while the instance is not ready.
 */
export function setupErrorMessage(
  t: TFunction<'setup'>,
  tAuth: TFunction<'auth'>,
  code: string,
): string {
  if (code.startsWith('signin-')) {
    const signInCode = code.slice('signin-'.length)
    const message = signInErrorMessage(tAuth, signInCode)
    return signInCode === 'invalid-code' ? t('signInRefused', { message }) : message
  }
  return isSetupError(code) ? t(`errors.${code}`) : t('errors.unknown')
}

const MANIFEST_ORIGIN = 'https://github.com/'

/** The manifest flow is a form POST to github.com, with the manifest as JSON in one field. */
export function buildManifestForm(
  doc: Document,
  postUrl: string,
  manifest: Record<string, unknown>,
): HTMLFormElement {
  if (!postUrl.startsWith(MANIFEST_ORIGIN)) {
    throw new Error(`Refusing to send the App manifest anywhere but ${MANIFEST_ORIGIN}`)
  }
  const form = doc.createElement('form')
  form.method = 'post'
  form.action = postUrl
  const input = doc.createElement('input')
  input.type = 'hidden'
  input.name = 'manifest'
  input.value = JSON.stringify(manifest)
  form.append(input)
  return form
}

/** The public URL as RepoERD stores it: no trailing slash (the callback URL is built on it). */
export const trimTrailingSlashes = (url: string) => url.trim().replace(/\/+$/, '')

/** A GitHub App ID: a positive whole number (at most 10 digits). */
export const isValidAppId = (text: string) => /^[1-9]\d{0,9}$/.test(text.trim())
