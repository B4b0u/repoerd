import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useApiErrorMessage } from '../../shared/i18n/api-error-message'
import { CardHeading } from '../../shared/ui/CardHeading'
import { Card, CardContent } from '../../shared/ui/card'
import { PageMessage } from '../../shared/ui/PageMessage'

/** A card of /admin: its content once its data came, else its title with "Loading…" or the error and "Retry". */
export function QueryCard<T>({
  title,
  query,
  children,
}: {
  title: string
  query: UseQueryResult<T, Error>
  children: (data: T) => ReactNode
}) {
  const { t } = useTranslation('common')
  const apiMessage = useApiErrorMessage()
  if (query.data !== undefined) return <>{children(query.data)}</>
  return (
    <Card>
      <CardHeading title={title} />
      <CardContent>
        {query.isError ? (
          <PageMessage tone="error" onRetry={() => void query.refetch()}>
            {apiMessage(query.error)}
          </PageMessage>
        ) : (
          <PageMessage>{t('loading')}</PageMessage>
        )}
      </CardContent>
    </Card>
  )
}
