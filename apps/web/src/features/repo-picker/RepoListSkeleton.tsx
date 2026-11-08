import { useTranslation } from 'react-i18next'
import { Card } from '../../shared/ui/card'
import { Skeleton } from '../../shared/ui/skeleton'

const CARDS = [0, 1, 2]
const ROWS = [0, 1, 2, 3, 4, 5, 6, 7]
// Varied name lengths read as a list rather than a pattern.
const ROW_WIDTHS = ['w-40', 'w-28', 'w-52', 'w-36', 'w-24', 'w-44', 'w-32', 'w-48']

/** The shape of the page while the list loads; screen readers hear "Loading repositories…". */
export function RepoListSkeleton() {
  const { t } = useTranslation('repos')
  return (
    <div role="status" className="flex flex-col gap-8">
      <span className="sr-only">{t('loading')}</span>
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((card) => (
            <div key={card} className="flex flex-col gap-2.5 rounded-xl border bg-card p-4">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-5 w-36" />
              <Skeleton className="mt-1 h-4 w-28" />
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-4 w-32" />
        <Card className="gap-0 divide-y overflow-hidden py-0">
          {ROWS.map((row) => (
            <div key={row} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className={`h-4 ${ROW_WIDTHS[row]}`} />
              <Skeleton className="ml-auto h-4 w-16 rounded-full" />
              <Skeleton className="hidden h-4 w-20 sm:block" />
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}
