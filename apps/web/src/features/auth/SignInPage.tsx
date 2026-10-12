import { APP_REPLACED_NOTICE, apiPaths } from '@repoerd/contracts'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { dropErrorParam, pathWithoutError, useSetupStatus } from '../../shared/api/session'
import { LanguageMenu } from '../../shared/i18n/LanguageMenu'
import { usePageTitle } from '../../shared/lib/page-title'
import { Alert, AlertDescription } from '../../shared/ui/alert'
import { Button } from '../../shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../shared/ui/card'
import { FormError } from '../../shared/ui/FormError'
import { ThemeToggle } from '../../shared/ui/ThemeToggle'
import { signInErrorMessage } from './messages'

export function SignInPage() {
  const { t } = useTranslation('auth')
  usePageTitle(t('pageTitle'))
  // Read once: the error and the notice leave the URL below, so a reload does not replay them.
  const [{ error, appReplaced, next }] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const replaced = params.get('notice') === APP_REPLACED_NOTICE
    return {
      error: params.get('error'),
      appReplaced: replaced,
      // On /signin itself, come back to the repositories (to /admin after an App replacement);
      // elsewhere, to the page that was asked for.
      next:
        window.location.pathname === '/signin' ? (replaced ? '/admin' : '/') : pathWithoutError(),
    }
  })
  // The gate already loaded it: the install link of the new App costs no request.
  const setup = useSetupStatus(appReplaced)
  useEffect(() => {
    dropErrorParam()
  }, [])
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 p-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl tracking-tight">RepoERD</h1>
          </CardTitle>
          <CardDescription>{t('intro')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-left">
          {appReplaced && (
            <Alert role="status">
              <AlertDescription className="flex flex-col gap-3">
                <p>{t('appReplaced')}</p>
                {setup.data?.app && (
                  <Button asChild variant="outline" className="w-full">
                    <a href={setup.data.app.installUrl} target="_blank" rel="noreferrer">
                      {t('installApp', { appName: setup.data.app.name })}
                    </a>
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          {error && <FormError>{signInErrorMessage(t, error)}</FormError>}
          <Button asChild className="w-full">
            <a href={apiPaths.signIn(next)}>{t('signIn')}</a>
          </Button>
        </CardContent>
      </Card>
      <div className="flex items-center gap-1">
        <LanguageMenu />
        <ThemeToggle />
      </div>
    </main>
  )
}
