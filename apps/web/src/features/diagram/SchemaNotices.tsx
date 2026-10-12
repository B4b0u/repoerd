import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '../../shared/ui/alert'

/**
 * The status bar of the diagram: what the displayed schema leaves out (a file list GitHub cut,
 * views that are not drawn). Advisory, outside the diagram section.
 */
export function SchemaNotices({
  treeTruncated,
  ignoredViews,
}: {
  treeTruncated: boolean
  ignoredViews: number
}) {
  const { t } = useTranslation('diagram')
  if (!treeTruncated && ignoredViews === 0) return null
  return (
    <Alert role="status" className="shrink-0 rounded-none border-x-0 border-t-0 px-4 py-2">
      <AlertDescription>
        {treeTruncated && <p>{t('treeTruncated')}</p>}
        {ignoredViews > 0 && <p>{t('ignoredViews', { count: ignoredViews })}</p>}
      </AlertDescription>
    </Alert>
  )
}
