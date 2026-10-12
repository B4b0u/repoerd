import {
  apiPaths,
  isInsecurePublicUrl,
  type ManifestResponse,
  type SetupStatusResponse,
} from '@repoerd/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'wouter'
import { apiPost, apiSend } from '../../shared/api/client'
import { dropErrorParam, sessionKeys, useSetupStatus } from '../../shared/api/session'
import { useApiErrorMessage } from '../../shared/i18n/api-error-message'
import { LanguageMenu } from '../../shared/i18n/LanguageMenu'
import { usePageTitle } from '../../shared/lib/page-title'
import { cn } from '../../shared/lib/utils'
import { Button } from '../../shared/ui/button'
import { CardHeading } from '../../shared/ui/CardHeading'
import { Card, CardContent, CardFooter } from '../../shared/ui/card'
import { FormError } from '../../shared/ui/FormError'
import { FormField } from '../../shared/ui/FormField'
import { Input } from '../../shared/ui/input'
import { PageLayout } from '../../shared/ui/PageLayout'
import { PageMessage } from '../../shared/ui/PageMessage'
import { ThemeToggle } from '../../shared/ui/ThemeToggle'
import { Choice, CreateAppForm, ExistingAppForm } from './AppRegistration'
import { type SetupStep, setupErrorMessage, setupStep, trimTrailingSlashes } from './setup-step'

const STEPS: SetupStep[] = ['unlock', 'register-app', 'become-admin', 'done']

export function SetupPage() {
  const { t } = useTranslation('setup')
  usePageTitle(t('title'))
  const { t: tAuth } = useTranslation('auth')
  const { t: tCommon } = useTranslation('common')
  const apiMessage = useApiErrorMessage()
  const status = useSetupStatus()
  // "Use another GitHub App" shows the App step again while the server waits for the administrator.
  const [replacingApp, setReplacingApp] = useState(false)
  const serverStep = status.data && setupStep(status.data)
  const current = replacingApp && serverStep === 'become-admin' ? 'register-app' : serverStep
  const error = useLoadError(current)
  return (
    <PageLayout
      title={t('title')}
      actions={
        <>
          <LanguageMenu />
          <ThemeToggle />
        </>
      }
    >
      {error && <FormError>{setupErrorMessage(t, tAuth, error)}</FormError>}
      {status.isPending && <PageMessage>{tCommon('loading')}</PageMessage>}
      {status.isError && (
        <PageMessage tone="error">
          {tCommon('serverUnreachable', { message: apiMessage(status.error) })}
        </PageMessage>
      )}
      {status.data && current && (
        <SetupSteps
          status={status.data}
          current={current}
          onReplaceApp={() => setReplacingApp(true)}
          onAppSaved={() => setReplacingApp(false)}
        />
      )}
    </PageLayout>
  )
}

/** The `?error=` the page was opened with, until the user moves past the step it was about. */
function useLoadError(current: SetupStep | undefined) {
  const [error, setError] = useState(() => new URLSearchParams(window.location.search).get('error'))
  const loadStep = useRef<SetupStep | undefined>(undefined)
  // Keep the message on screen but not in the URL, so a reload or a shared link does not replay it.
  useEffect(() => {
    dropErrorParam()
  }, [])
  useEffect(() => {
    if (!current) return
    loadStep.current ??= current
    if (current !== loadStep.current) setError(null)
  }, [current])
  return error
}

function SetupSteps({
  status,
  current,
  onReplaceApp,
  onAppSaved,
}: {
  status: SetupStatusResponse
  current: SetupStep
  onReplaceApp: () => void
  onAppSaved: () => void
}) {
  const { t } = useTranslation('setup')
  const currentIndex = STEPS.indexOf(current)
  return (
    <>
      <ol
        aria-label={t('progress')}
        className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
      >
        {STEPS.map((step, index) => (
          <li
            key={step}
            aria-current={step === current ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2',
              step === current ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border text-xs',
                step === current && 'border-primary bg-primary text-primary-foreground',
                index < currentIndex && 'border-primary text-primary',
              )}
            >
              {index < currentIndex ? (
                <>
                  <Check aria-hidden className="size-3.5" />
                  <span className="sr-only">{t('stepDone')}</span>
                </>
              ) : (
                index + 1
              )}
            </span>
            {t(`steps.${step}`)}
          </li>
        ))}
      </ol>
      {current === 'unlock' && <UnlockStep />}
      {current === 'register-app' && (
        <RegisterAppStep savedUrl={status.publicUrl} onSaved={onAppSaved} />
      )}
      {current === 'become-admin' && (
        <BecomeAdminStep
          appName={status.app?.name ?? t('becomeAdmin.defaultAppName')}
          onReplaceApp={onReplaceApp}
        />
      )}
      {current === 'done' && <DoneStep status={status} />}
    </>
  )
}

function useRefreshStatus() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: sessionKeys.setupStatus })
}

function UnlockStep() {
  const { t } = useTranslation('setup')
  const apiMessage = useApiErrorMessage()
  const queryClient = useQueryClient()
  const refresh = useRefreshStatus()
  const [code, setCode] = useState('')
  const [cookieDropped, setCookieDropped] = useState(false)
  const unlock = useMutation({
    mutationFn: () => apiSend('POST', apiPaths.setupUnlock, { code }),
    onSuccess: async () => {
      await refresh()
      // The code was accepted but the browser did not keep the Secure grant cookie (plain HTTP).
      // Only trust a refetch that succeeded: after a failed one the cache still holds the old answer.
      const state = queryClient.getQueryState<SetupStatusResponse>(sessionKeys.setupStatus)
      setCookieDropped(state?.status === 'success' && state.data?.unlocked === false)
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setCookieDropped(false)
    unlock.mutate()
  }
  return (
    <Card>
      <form className="flex flex-col gap-6" onSubmit={submit}>
        <CardHeading title={t('unlock.title')}>{t('unlock.intro')}</CardHeading>
        <CardContent className="flex flex-col gap-4">
          <FormField label={t('unlock.code')}>
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="XXXX-XXXX-XXXX"
              autoComplete="off"
              className="font-mono"
              required
            />
          </FormField>
          {unlock.isError && <FormError>{apiMessage(unlock.error)}</FormError>}
          {cookieDropped && (
            <FormError>
              <Trans
                t={t}
                i18nKey="unlock.cookieRefused"
                components={{ code: <code className="font-mono" /> }}
              />
            </FormError>
          )}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={unlock.isPending}>
            {t('unlock.submit')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function RegisterAppStep({ savedUrl, onSaved }: { savedUrl: string | null; onSaved: () => void }) {
  const { t } = useTranslation('setup')
  const refresh = useRefreshStatus()
  const [publicUrl, setPublicUrl] = useState(savedUrl ?? window.location.origin)
  const [choice, setChoice] = useState<'create' | 'existing'>('create')
  const cleanUrl = trimTrailingSlashes(publicUrl)
  return (
    <Card>
      <CardHeading title={t('registerApp.title')}>{t('registerApp.intro')}</CardHeading>
      <CardContent className="flex flex-col gap-6">
        <FormField
          label={t('registerApp.publicUrl')}
          hint={isInsecurePublicUrl(publicUrl) ? t('registerApp.insecureUrl') : undefined}
        >
          <Input
            type="url"
            value={publicUrl}
            onChange={(event) => setPublicUrl(event.target.value)}
            required
          />
        </FormField>
        <Choice
          legend={t('registerApp.app')}
          value={choice}
          onChange={setChoice}
          options={[
            { value: 'create', label: t('registerApp.create') },
            { value: 'existing', label: t('registerApp.existing') },
          ]}
        />
        {choice === 'create' ? (
          <CreateAppForm
            start={(organization) =>
              apiPost<ManifestResponse>(apiPaths.setupManifest, {
                publicUrl: cleanUrl,
                organization,
              })
            }
          />
        ) : (
          <ExistingAppForm
            callbackUrl={`${cleanUrl}/auth/callback`}
            save={(credentials) =>
              apiSend('POST', apiPaths.setupExistingApp, { publicUrl: cleanUrl, ...credentials })
            }
            onSaved={async () => {
              await refresh()
              onSaved()
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}

function BecomeAdminStep({ appName, onReplaceApp }: { appName: string; onReplaceApp: () => void }) {
  const { t } = useTranslation('setup')
  return (
    <Card>
      <CardHeading title={t('becomeAdmin.title')}>
        <Trans
          t={t}
          i18nKey="becomeAdmin.intro"
          values={{ appName }}
          tOptions={{ interpolation: { escapeValue: true } }}
          shouldUnescape
          components={{ strong: <strong className="text-foreground" /> }}
        />
      </CardHeading>
      <CardContent className="flex flex-col gap-4">
        <Button asChild className="w-fit">
          <a href={apiPaths.signIn('/setup')}>{t('becomeAdmin.signIn')}</a>
        </Button>
        <p className="text-sm text-muted-foreground">
          {t('becomeAdmin.stuck')}{' '}
          <Button type="button" variant="link" className="h-auto p-0" onClick={onReplaceApp}>
            {t('becomeAdmin.replaceApp')}
          </Button>
        </p>
      </CardContent>
    </Card>
  )
}

function DoneStep({ status }: { status: SetupStatusResponse }) {
  const { t } = useTranslation('setup')
  const fake = status.mode === 'fake'
  const openRepos = (
    <Button asChild variant={fake || !status.app ? 'default' : 'outline'} className="w-fit">
      <Link href="/" className="no-underline">
        {t('done.openRepos')}
      </Link>
    </Button>
  )
  if (fake) {
    return (
      <Card>
        <CardHeading title={t('done.fakeTitle')}>
          <Trans
            t={t}
            i18nKey="done.fakeIntro"
            components={{ code: <code className="font-mono" /> }}
          />
        </CardHeading>
        <CardContent>{openRepos}</CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeading title={t('done.title')}>{t('done.intro')}</CardHeading>
      <CardContent className="flex flex-wrap gap-2">
        {status.app && (
          <Button asChild className="w-fit">
            <a href={status.app.installUrl} target="_blank" rel="noreferrer">
              {t('done.install', { appName: status.app.name })}
            </a>
          </Button>
        )}
        {openRepos}
      </CardContent>
    </Card>
  )
}
