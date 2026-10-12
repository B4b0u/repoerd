import { type AdminConfigResponse, APP_REPLACED_PATH } from '@repoerd/contracts'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../shared/ui/alert-dialog'
import { Button } from '../../shared/ui/button'
import { CardHeading } from '../../shared/ui/CardHeading'
import { Card, CardContent } from '../../shared/ui/card'
import { FormError } from '../../shared/ui/FormError'
import { Choice, CreateAppForm, ExistingAppForm } from '../setup/AppRegistration'
import { replaceWithExistingApp, startAppReplacement } from './api'
import { replaceAppErrorMessage } from './replace-app-error'

/**
 * Replacing the GitHub App (spec §4.2): another App, or new credentials of this one. The forms
 * appear once the administrator accepted that everyone, them included, will be signed out.
 */
export function ReplaceAppSection({
  config,
  initialError,
}: {
  config: AdminConfigResponse
  initialError: string | null
}) {
  const { t } = useTranslation('admin')
  const { t: tSetup } = useTranslation('setup')
  const { t: tCommon } = useTranslation('common')
  // Back from GitHub with an error: the forms stay open next to the message.
  const [open, setOpen] = useState(initialError !== null)
  const [shownError, setShownError] = useState(initialError)
  const [confirming, setConfirming] = useState(false)
  const [choice, setChoice] = useState<'create' | 'existing'>('create')
  return (
    <Card>
      <CardHeading title={t('replaceApp.title')}>{t('replaceApp.intro')}</CardHeading>
      <CardContent className="flex flex-col gap-6">
        {shownError && <FormError>{replaceAppErrorMessage(t, shownError)}</FormError>}
        {open ? (
          <>
            <Choice
              legend={tSetup('registerApp.app')}
              value={choice}
              onChange={setChoice}
              options={[
                { value: 'create', label: tSetup('registerApp.create') },
                { value: 'existing', label: t('replaceApp.existing') },
              ]}
            />
            {choice === 'create' ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{t('replaceApp.nameHint')}</p>
                <CreateAppForm start={startAppReplacement} onSubmit={() => setShownError(null)} />
              </div>
            ) : (
              <ExistingAppForm
                callbackUrl={config.callbackUrl ?? ''}
                save={replaceWithExistingApp}
                onSaved={() => window.location.assign(APP_REPLACED_PATH)}
                submitLabel={t('replaceApp.existingSubmit')}
                onSubmit={() => setShownError(null)}
              />
            )}
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => setConfirming(true)}
          >
            <RefreshCw />
            {t('replaceApp.start')}
          </Button>
        )}
      </CardContent>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('replaceApp.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('replaceApp.confirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => setOpen(true)}>
              {t('replaceApp.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
