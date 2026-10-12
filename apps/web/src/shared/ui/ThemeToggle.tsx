import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useThemeContext } from '../theme/theme-context'
import { IconButton } from './IconButton'

export function ThemeToggle() {
  const { t } = useTranslation('common')
  const { theme, toggle } = useThemeContext()
  return (
    <IconButton label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')} onClick={toggle}>
      {theme === 'dark' ? <Sun /> : <Moon />}
    </IconButton>
  )
}
