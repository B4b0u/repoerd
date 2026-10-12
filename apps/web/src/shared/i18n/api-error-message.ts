import type { ApiErrorCode, ApiErrorReason } from '@repoerd/contracts'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import { en } from './locales/en'

const isCode = (code: string): code is ApiErrorCode => Object.hasOwn(en.errors.codes, code)
const isReason = (reason: unknown): reason is ApiErrorReason =>
  typeof reason === 'string' && Object.hasOwn(en.errors.reasons, reason)

/**
 * The text of a failed request, translated from its code and details. Anything unknown (another
 * server version) keeps the server's own message, as do internal errors. A network failure (TypeError) and an empty error response get their own text.
 */
export function apiErrorMessage(t: TFunction<'errors'>, error: Error): string {
  if (error instanceof TypeError) return t('network')
  if (!(error instanceof ApiError)) return error.message
  if (error.code === 'unknown' && error.message === '') return t('http', { status: error.status })
  const { reason, ...values } = error.details
  if (reason !== undefined) return isReason(reason) ? t(`reasons.${reason}`, values) : error.message
  return isCode(error.code) ? t(`codes.${error.code}`, values) : error.message
}

export function useApiErrorMessage(): (error: Error) => string {
  const { t } = useTranslation('errors')
  return (error) => apiErrorMessage(t, error)
}
