import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Redirect, useLocation, useSearch } from 'wouter'
import { SignInPage } from '../features/auth/SignInPage'
import { authErrorAction, useMe, useSetupStatus } from '../shared/api/session'
import { useApiErrorMessage } from '../shared/i18n/api-error-message'
import { PageMessage } from '../shared/ui/PageMessage'
import { decideGate, setupRedirectTarget } from './gate'

export function AppGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common')
  const apiMessage = useApiErrorMessage()
  const [path] = useLocation()
  const search = useSearch()
  const setup = useSetupStatus()
  const ready = setup.data?.state === 'ready'
  const me = useMe(ready && path !== '/setup' && path !== '/signin')
  const signedIn = me.isSuccess
    ? true
    : authErrorAction(me.error) === 'signed-out'
      ? false
      : undefined

  if (path !== '/setup' && setup.isError) {
    return (
      <PageMessage tone="error" onRetry={() => void setup.refetch()}>
        {t('serverUnreachable', { message: apiMessage(setup.error) })}
      </PageMessage>
    )
  }
  if (me.isError && signedIn === undefined) {
    return (
      <PageMessage tone="error" onRetry={() => void me.refetch()}>
        {t('accountUnavailable', { message: apiMessage(me.error) })}
      </PageMessage>
    )
  }
  switch (decideGate({ path, setup: setup.data, signedIn })) {
    case 'loading':
      return <PageMessage>{t('loading')}</PageMessage>
    case 'setup':
      return <Redirect to={setupRedirectTarget(path, search)} />
    case 'sign-in':
      return <SignInPage />
    case 'app':
      return <>{children}</>
  }
}
