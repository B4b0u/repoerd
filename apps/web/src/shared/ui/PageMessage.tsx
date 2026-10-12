import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './button'

/** A page-level state: loading, empty, or an error (announced), with "Retry" when given. */
export function PageMessage({
  tone = 'muted',
  children,
  onRetry,
}: {
  tone?: 'muted' | 'error'
  children: ReactNode
  /** The failed request can be sent again. */
  onRetry?: () => void
}) {
  const { t } = useTranslation('common')
  if (tone === 'error') {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p role="alert" className="font-mono text-sm whitespace-pre-wrap text-destructive">
          {children}
        </p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('retry')}
          </Button>
        )}
      </div>
    )
  }
  return (
    <p role="status" className="p-6 text-sm whitespace-pre-wrap text-muted-foreground">
      {children}
    </p>
  )
}
