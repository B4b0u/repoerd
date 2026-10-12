import { LogOut, Moon, Shield, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Link } from 'wouter'
import { signOut, useMe } from '../../shared/api/session'
import { LanguageRadioGroup } from '../../shared/i18n/LanguageMenu'
import { useThemeContext } from '../../shared/theme/theme-context'
import { Avatar, AvatarFallback, AvatarImage } from '../../shared/ui/avatar'
import { Button } from '../../shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../shared/ui/dropdown-menu'

/** The account menu: language, theme, administration and sign-out. */
export function UserMenu() {
  const { t } = useTranslation('common')
  const { theme, toggle } = useThemeContext()
  const me = useMe()
  if (!me.data) return null
  const { user, mode } = me.data
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 px-1.5">
          <Avatar className="size-6" aria-hidden>
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
            <AvatarFallback className="text-xs">
              {user.login.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="sr-only xl:not-sr-only xl:max-w-32 xl:truncate">{user.login}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {t('userMenu.signedInAs', { login: user.login })}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <LanguageRadioGroup />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={toggle}>
          {theme === 'dark' ? <Sun /> : <Moon />}
          {theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
        </DropdownMenuItem>
        {user.isAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/admin" className="text-inherit no-underline">
              <Shield />
              {t('userMenu.admin')}
            </Link>
          </DropdownMenuItem>
        )}
        {mode === 'real' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => void signOut().catch(() => toast.error(t('userMenu.signOutFailed')))}
            >
              <LogOut />
              {t('userMenu.signOut')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
