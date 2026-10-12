import type { AdminConfigResponse, AdminListResponse } from '@repoerd/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PackagePlus, Settings, UserMinus, UserPlus } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ApiError } from '../../shared/api/client'
import { dropErrorParam, sessionKeys, useMe } from '../../shared/api/session'
import { useApiErrorMessage } from '../../shared/i18n/api-error-message'
import { usePageTitle } from '../../shared/lib/page-title'
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
import { Avatar, AvatarFallback, AvatarImage } from '../../shared/ui/avatar'
import { Badge } from '../../shared/ui/badge'
import { Button, buttonVariants } from '../../shared/ui/button'
import { CardHeading } from '../../shared/ui/CardHeading'
import { Card, CardContent, CardFooter } from '../../shared/ui/card'
import { FormError } from '../../shared/ui/FormError'
import { FormField } from '../../shared/ui/FormField'
import { IconButton } from '../../shared/ui/IconButton'
import { Input } from '../../shared/ui/input'
import { BackLink, PageLayout } from '../../shared/ui/PageLayout'
import { PageMessage } from '../../shared/ui/PageMessage'
import { UserMenu } from '../auth/UserMenu'
import {
  addAdmin,
  adminKeys,
  removeAdmin,
  saveAdminConfig,
  useAdminConfig,
  useAdmins,
  useUsers,
} from './api'
import { formatOrgs, parseOrgs } from './orgs'
import { QueryCard } from './QueryCard'
import { ReplaceAppSection } from './ReplaceAppSection'
import { UsersSection } from './UsersSection'
import { useSyncedDraft } from './use-synced-draft'

export function AdminPage() {
  const { t } = useTranslation('admin')
  usePageTitle(t('title'))
  const me = useMe()
  const isAdmin = me.data?.user.isAdmin === true
  const selfId = me.data?.user.id
  const config = useAdminConfig(isAdmin)
  const admins = useAdmins(isAdmin)
  const users = useUsers(isAdmin)
  // GitHub's replacement callback comes back with `?error=`: read it once, then drop it.
  const [replaceError] = useState(() => new URLSearchParams(window.location.search).get('error'))
  useEffect(() => {
    dropErrorParam()
  }, [])
  return (
    <PageLayout
      back={<BackLink href="/">{t('back')}</BackLink>}
      title={t('title')}
      actions={<UserMenu />}
    >
      {me.data && !isAdmin && <PageMessage>{t('adminsOnly')}</PageMessage>}
      {isAdmin && (
        <QueryCard title={t('app.title')} query={config}>
          {(data) => (
            <>
              <AppSection config={data} />
              {data.mode === 'real' && data.app && (
                <ReplaceAppSection config={data} initialError={replaceError} />
              )}
              {data.mode === 'real' && <PublicUrlSection config={data} />}
              <OrganisationsSection config={data} />
            </>
          )}
        </QueryCard>
      )}
      {isAdmin && selfId && (
        <QueryCard title={t('admins.title')} query={admins}>
          {(data) => <AdminsSection admins={data} selfId={selfId} />}
        </QueryCard>
      )}
      {isAdmin && selfId && (
        <QueryCard title={t('users.title')} query={users}>
          {(data) => <UsersSection users={data} selfId={selfId} />}
        </QueryCard>
      )}
    </PageLayout>
  )
}

function AppSection({ config }: { config: AdminConfigResponse }) {
  const { t } = useTranslation('admin')
  return (
    <Card>
      <CardHeading title={t('app.title')} />
      <CardContent className="flex flex-col gap-3 text-sm">
        {config.app ? (
          <>
            <p>
              <Trans
                t={t}
                i18nKey="app.owned"
                values={{ name: config.app.name, owner: config.app.ownerLogin }}
                tOptions={{ interpolation: { escapeValue: true } }}
                shouldUnescape
                components={{ strong: <strong /> }}
              />
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a
                  href={config.app.settingsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground no-underline"
                >
                  <Settings />
                  {t('app.settings')}
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a
                  href={config.app.installUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground no-underline"
                >
                  <PackagePlus />
                  {t('app.install')}
                </a>
              </Button>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">
            {config.mode === 'fake' ? t('app.fake') : t('app.none')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function useSaveConfig(onSaved: (saved: AdminConfigResponse) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveAdminConfig,
    onSuccess: (saved) => {
      queryClient.setQueryData(adminKeys.config, saved)
      onSaved(saved)
    },
    onError: (error) => {
      // Another administrator saved meanwhile: show what is saved now (untouched fields follow).
      if (error instanceof ApiError && error.details.reason === 'config-changed')
        void queryClient.invalidateQueries({ queryKey: adminKeys.config })
    },
  })
}

function PublicUrlSection({ config }: { config: AdminConfigResponse }) {
  const { t } = useTranslation('admin')
  const apiMessage = useApiErrorMessage()
  const [publicUrl, setPublicUrl] = useSyncedDraft(config.publicUrl ?? '')
  const save = useSaveConfig((saved) => {
    setPublicUrl(saved.publicUrl ?? '')
    toast.success(t('publicUrl.saved'))
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate({ allowedOrgs: config.allowedOrgs, publicUrl, version: config.version })
  }
  const hint = config.callbackUrl && (
    <>
      <Trans
        t={t}
        i18nKey="publicUrl.hint"
        values={{ callbackUrl: config.callbackUrl }}
        tOptions={{ interpolation: { escapeValue: true } }}
        shouldUnescape
        components={{ code: <code className="font-mono text-foreground" /> }}
      />
      {config.app && (
        <>
          {' '}
          <a href={config.app.settingsUrl} target="_blank" rel="noreferrer">
            {t('publicUrl.openSettings')}
          </a>
        </>
      )}
    </>
  )
  return (
    <Card>
      <form className="flex flex-col gap-6" onSubmit={submit}>
        <CardHeading title={t('publicUrl.title')} />
        <CardContent className="flex flex-col gap-4">
          <FormField label={t('publicUrl.label')} hint={hint}>
            <Input
              type="url"
              value={publicUrl}
              onChange={(event) => {
                setPublicUrl(event.target.value)
                save.reset()
              }}
              required
            />
          </FormField>
          {save.isError && <FormError>{apiMessage(save.error)}</FormError>}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={save.isPending}>
            {t('publicUrl.save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function OrganisationsSection({ config }: { config: AdminConfigResponse }) {
  const { t } = useTranslation('admin')
  const apiMessage = useApiErrorMessage()
  const [text, setText] = useSyncedDraft(formatOrgs(config.allowedOrgs))
  const save = useSaveConfig((savedConfig) => {
    // Show what the server kept (lowercased, deduplicated), not what was typed.
    setText(formatOrgs(savedConfig.allowedOrgs))
    toast.success(t('orgs.saved'))
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate({ allowedOrgs: parseOrgs(text), version: config.version })
  }
  return (
    <Card>
      <form className="flex flex-col gap-6" onSubmit={submit}>
        <CardHeading title={t('orgs.title')} />
        <CardContent className="flex flex-col gap-4">
          <FormField label={t('orgs.label')} hint={t('orgs.hint')}>
            <Input
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                save.reset()
              }}
              placeholder="acme, another-org"
            />
          </FormField>
          {save.isError && <FormError>{apiMessage(save.error)}</FormError>}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={save.isPending}>
            {t('orgs.save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function AdminsSection({ admins, selfId }: { admins: AdminListResponse; selfId: string }) {
  const { t } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const apiMessage = useApiErrorMessage()
  const queryClient = useQueryClient()
  const [login, setLogin] = useState('')
  const [confirmingSelf, setConfirmingSelf] = useState(false)
  const onChanged = (list: AdminListResponse) => {
    queryClient.setQueryData(adminKeys.admins, list)
    // Removing yourself ends your access to this page.
    void queryClient.invalidateQueries({ queryKey: sessionKeys.me })
  }
  const add = useMutation({
    mutationFn: () => addAdmin(login.trim()),
    onSuccess: (list) => {
      setLogin('')
      onChanged(list)
    },
  })
  const remove = useMutation({ mutationFn: removeAdmin, onSuccess: onChanged })
  const removeRights = (id: string) => {
    add.reset()
    remove.mutate(id)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    remove.reset()
    add.mutate()
  }
  const error = add.error ?? remove.error
  return (
    <Card>
      <CardHeading title={t('admins.title')} />
      <CardContent className="flex flex-col gap-4">
        <ul aria-label={t('admins.title')} className="divide-y rounded-md border">
          {admins.admins.map((admin) => (
            <li key={admin.id} className="flex items-center gap-3 px-3 py-2">
              <Avatar className="size-7" aria-hidden>
                {admin.avatarUrl && <AvatarImage src={admin.avatarUrl} alt="" />}
                <AvatarFallback className="text-xs">
                  {admin.login.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
                <span className="truncate">{admin.login}</span>
                {admin.id === selfId && <Badge variant="secondary">{t('admins.you')}</Badge>}
              </span>
              <IconButton
                label={t('admins.remove', { login: admin.login })}
                disabled={admins.admins.length === 1 || remove.isPending}
                onClick={() =>
                  admin.id === selfId ? setConfirmingSelf(true) : removeRights(admin.id)
                }
              >
                <UserMinus />
              </IconButton>
            </li>
          ))}
        </ul>
        <form className="flex items-end gap-2" onSubmit={submit}>
          <div className="flex-1">
            <FormField label={t('admins.login')}>
              <Input value={login} onChange={(event) => setLogin(event.target.value)} required />
            </FormField>
          </div>
          <Button type="submit" disabled={add.isPending}>
            <UserPlus />
            {t('admins.add')}
          </Button>
        </form>
        <p className="text-sm text-muted-foreground">{t('admins.hint')}</p>
        {error && <FormError>{apiMessage(error)}</FormError>}
      </CardContent>
      <AlertDialog open={confirmingSelf} onOpenChange={setConfirmingSelf}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admins.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('admins.confirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => removeRights(selfId)}
            >
              {t('admins.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
