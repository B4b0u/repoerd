import type { ExistingAppBody, ManifestResponse } from '@repoerd/contracts'
import { useMutation } from '@tanstack/react-query'
import { type ChangeEvent, type FormEvent, useId, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useApiErrorMessage } from '../../shared/i18n/api-error-message'
import { Button } from '../../shared/ui/button'
import { FormError } from '../../shared/ui/FormError'
import { FormField } from '../../shared/ui/FormField'
import { Input } from '../../shared/ui/input'
import { Label } from '../../shared/ui/label'
import { RadioGroup, RadioGroupItem } from '../../shared/ui/radio-group'
import { Textarea } from '../../shared/ui/textarea'
import { buildManifestForm, isValidAppId } from './setup-step'

export interface ChoiceOption<T extends string> {
  value: T
  label: string
  /** Shown under the option and read with it by screen readers. */
  hint?: string
}

/** Radio choices with a legend, for the App decisions of /setup and /admin. */
export function Choice<T extends string>({
  legend,
  value,
  onChange,
  options,
}: {
  legend: string
  value: T
  onChange: (value: T) => void
  options: ChoiceOption<T>[]
}) {
  const id = useId()
  return (
    <fieldset className="flex flex-col gap-3">
      <legend id={`${id}-legend`} className="text-sm font-medium">
        {legend}
      </legend>
      <RadioGroup
        aria-labelledby={`${id}-legend`}
        value={value}
        onValueChange={(next) => {
          const option = options.find((candidate) => candidate.value === next)
          if (option) onChange(option.value)
        }}
      >
        {options.map((option) => (
          <div key={option.value} className="flex items-start gap-2">
            <RadioGroupItem
              value={option.value}
              id={`${id}-${option.value}`}
              aria-describedby={option.hint ? `${id}-${option.value}-hint` : undefined}
              className="mt-0.5"
            />
            <div className="grid gap-1">
              <Label htmlFor={`${id}-${option.value}`} className="font-normal">
                {option.label}
              </Label>
              {option.hint && (
                <p id={`${id}-${option.value}-hint`} className="text-sm text-muted-foreground">
                  {option.hint}
                </p>
              )}
            </div>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  )
}

/**
 * Creates the App on GitHub through the manifest flow: `start` asks the server for the manifest
 * (setup or replacement route), then the browser posts it to github.com. An organisation is the
 * default owner: a private App of a personal account can only be installed on that account.
 */
export function CreateAppForm({
  start,
  onSubmit,
}: {
  start: (organization: string | undefined) => Promise<ManifestResponse>
  /** Runs when the form is submitted (before anything is sent). */
  onSubmit?: () => void
}) {
  const { t } = useTranslation('setup')
  const apiMessage = useApiErrorMessage()
  const [owner, setOwner] = useState<'organization' | 'personal'>('organization')
  const [organization, setOrganization] = useState('')
  const create = useMutation({
    mutationFn: () => start(owner === 'organization' ? organization.trim() : undefined),
    onSuccess: ({ postUrl, manifest }) => {
      const form = buildManifestForm(document, postUrl, manifest)
      document.body.append(form)
      form.submit()
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit?.()
    create.mutate()
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Choice
        legend={t('registerApp.owner')}
        value={owner}
        onChange={setOwner}
        options={[
          { value: 'organization', label: t('registerApp.organization') },
          {
            value: 'personal',
            label: t('registerApp.personal'),
            hint: t('registerApp.personalWarning'),
          },
        ]}
      />
      {owner === 'organization' && (
        <FormField label={t('registerApp.organizationName')}>
          <Input
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
            required
          />
        </FormField>
      )}
      <p className="text-sm text-muted-foreground">{t('registerApp.createHint')}</p>
      {create.isError && <FormError>{apiMessage(create.error)}</FormError>}
      <Button type="submit" className="w-fit" disabled={create.isPending}>
        {t('registerApp.createSubmit')}
      </Button>
    </form>
  )
}

/** What identifies an existing GitHub App: the setup adds the public URL, /admin keeps the saved one. */
export type ExistingAppCredentials = Omit<ExistingAppBody, 'publicUrl'>

type ExistingAppFields = Record<keyof ExistingAppCredentials, string>

/** Credentials of an App created by hand; `save` sends them to the server, which checks them with GitHub. */
export function ExistingAppForm({
  callbackUrl,
  save,
  onSaved,
  submitLabel,
  onSubmit,
}: {
  callbackUrl: string
  save: (credentials: ExistingAppCredentials) => Promise<void>
  onSaved: () => unknown
  submitLabel?: string
  /** Runs when the form is submitted (before anything is sent). */
  onSubmit?: () => void
}) {
  const { t } = useTranslation('setup')
  const apiMessage = useApiErrorMessage()
  const [fields, setFields] = useState<ExistingAppFields>({
    appId: '',
    clientId: '',
    clientSecret: '',
    privateKey: '',
  })
  const [appIdInvalid, setAppIdInvalid] = useState(false)
  const saveApp = useMutation({
    mutationFn: () =>
      save({
        appId: Number(fields.appId.trim()),
        clientId: fields.clientId.trim(),
        clientSecret: fields.clientSecret.trim(),
        privateKey: fields.privateKey.trim(),
      }),
    onSuccess: async () => {
      await onSaved()
    },
  })
  const bind = (name: keyof ExistingAppFields) => ({
    value: fields[name],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (name === 'appId') setAppIdInvalid(false)
      setFields({ ...fields, [name]: event.target.value })
    },
    required: true,
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit?.()
    if (!isValidAppId(fields.appId)) {
      setAppIdInvalid(true)
      return
    }
    saveApp.mutate()
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">
        <Trans
          t={t}
          i18nKey="registerApp.existingHint"
          values={{ callbackUrl }}
          tOptions={{ interpolation: { escapeValue: true } }}
          shouldUnescape
          components={{ code: <code className="font-mono text-foreground" /> }}
        />
      </p>
      <FormField label={t('registerApp.appId')}>
        <Input inputMode="numeric" aria-invalid={appIdInvalid} {...bind('appId')} />
      </FormField>
      <FormField label={t('registerApp.clientId')}>
        <Input {...bind('clientId')} />
      </FormField>
      <FormField label={t('registerApp.clientSecret')}>
        <Input type="password" autoComplete="off" {...bind('clientSecret')} />
      </FormField>
      <FormField label={t('registerApp.privateKey')}>
        <Textarea
          rows={6}
          spellCheck={false}
          className="font-mono text-xs"
          {...bind('privateKey')}
        />
      </FormField>
      {appIdInvalid && <FormError>{t('registerApp.appIdInvalid')}</FormError>}
      {saveApp.isError && <FormError>{apiMessage(saveApp.error)}</FormError>}
      <Button type="submit" className="w-fit" disabled={saveApp.isPending}>
        {submitLabel ?? t('registerApp.existingSubmit')}
      </Button>
    </form>
  )
}
