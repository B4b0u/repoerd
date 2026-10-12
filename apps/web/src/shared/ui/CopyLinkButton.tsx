import { Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from './button'

export function CopyLinkButton() {
  const { t } = useTranslation('common')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success(t('copyLink.copied'))
    } catch {
      window.prompt(t('copyLink.prompt'), window.location.href)
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={() => void copy()}>
      <Link2 />
      <span className="sr-only xl:not-sr-only">{t('copyLink.action')}</span>
    </Button>
  )
}
