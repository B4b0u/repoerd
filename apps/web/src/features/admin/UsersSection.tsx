import type { AdminUserDto, AdminUsersResponse } from '@repoerd/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { sessionKeys } from '../../shared/api/session'
import { useApiErrorMessage } from '../../shared/i18n/api-error-message'
import { formatDate } from '../../shared/i18n/format'
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
import { buttonVariants } from '../../shared/ui/button'
import { CardHeading } from '../../shared/ui/CardHeading'
import { Card, CardContent } from '../../shared/ui/card'
import { FormError } from '../../shared/ui/FormError'
import { IconButton } from '../../shared/ui/IconButton'
import { adminKeys, signOutUser } from './api'

/** Every user, their activity and sessions, and « sign out everywhere » (spec §4.4). */
export function UsersSection({ users, selfId }: { users: AdminUsersResponse; selfId: string }) {
  const { t, i18n } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const apiMessage = useApiErrorMessage()
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Kept after closing, so the dialog text does not change during its close animation.
  const [target, setTarget] = useState<AdminUserDto | null>(null)
  const signOut = useMutation({
    mutationFn: (user: AdminUserDto) => signOutUser(user.id),
    onSuccess: (list, user) => {
      queryClient.setQueryData(adminKeys.users, list)
      toast.success(t('users.signedOut', { login: user.login }))
      // Your own sessions are gone: reloading your account leads to the sign-in page.
      if (user.id === selfId) void queryClient.invalidateQueries({ queryKey: sessionKeys.me })
    },
  })
  return (
    <Card>
      <CardHeading title={t('users.title')}>{t('users.intro')}</CardHeading>
      <CardContent className="flex flex-col gap-4">
        <ul aria-label={t('users.title')} className="divide-y rounded-md border">
          {users.users.map((user) => (
            <li key={user.id} className="flex items-center gap-3 px-3 py-2">
              <Avatar className="size-7" aria-hidden>
                {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                <AvatarFallback className="text-xs">
                  {user.login.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span className="truncate">{user.login}</span>
                  {user.stale && <Badge variant="outline">{t('users.stale')}</Badge>}
                  {user.isAdmin && <Badge variant="secondary">{t('users.admin')}</Badge>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {user.lastSeenAt
                    ? t('users.lastSeen', { date: formatDate(user.lastSeenAt, i18n.language) })
                    : t('users.neverSeen')}
                  {' · '}
                  {t('users.sessions', { count: user.activeSessions })}
                </span>
              </div>
              <IconButton
                label={t('users.signOut', { login: user.login })}
                disabled={user.activeSessions === 0 || signOut.isPending}
                onClick={() => {
                  setTarget(user)
                  setConfirmOpen(true)
                }}
              >
                <LogOut />
              </IconButton>
            </li>
          ))}
        </ul>
        {signOut.isError && <FormError>{apiMessage(signOut.error)}</FormError>}
      </CardContent>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('users.confirmTitle', { login: target?.login ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {target?.id === selfId ? t('users.confirmSelf') : t('users.confirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                if (target) signOut.mutate(target)
              }}
            >
              {t('users.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
