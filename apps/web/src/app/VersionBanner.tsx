import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { dismissNewVersion, useNewVersionAvailable } from '../shared/api/version'
import { Button } from '../shared/ui/button'
import { IconButton } from '../shared/ui/IconButton'

/** The server was upgraded since this tab was loaded: its API may have changed (spec §6.4). */
export function VersionBanner() {
  const { t } = useTranslation('common')
  if (!useNewVersionAvailable()) return null
  return (
    <div
      role="status"
      className="fixed top-15 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-md"
    >
      <span>{t('newVersion')}</span>
      <Button type="button" size="sm" onClick={() => window.location.reload()}>
        {t('reload')}
      </Button>
      <IconButton type="button" size="icon-xs" label={t('dismiss')} onClick={dismissNewVersion}>
        <X aria-hidden />
      </IconButton>
    </div>
  )
}
