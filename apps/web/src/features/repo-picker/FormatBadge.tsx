import type { RepoDto } from '@repoerd/contracts'
import { useTranslation } from 'react-i18next'
import { toLanguage } from '../../shared/i18n/i18n'
import { Badge } from '../../shared/ui/badge'
import { Skeleton } from '../../shared/ui/skeleton'
import { formatRelative } from './relative-time'

const KINDS = {
  prisma: ['prisma'],
  drizzle: ['drizzle'],
  both: ['prisma', 'drizzle'],
  none: [],
} as const

/** The schema format of a repository, saying when it was checked; a placeholder while detected. */
export function FormatBadge({ repo }: { repo: Pick<RepoDto, 'format' | 'formatPending'> }) {
  const { t, i18n } = useTranslation('repos')
  const { format } = repo
  if (!format) {
    return repo.formatPending ? (
      <Skeleton role="img" aria-label={t('detecting')} className="h-5 w-14 rounded-full" />
    ) : null
  }
  const checked = t('checked', {
    when: formatRelative(new Date(format.checkedAt), new Date(), toLanguage(i18n.language)),
  })
  return (
    <div title={checked} className="flex items-center gap-1">
      {format.kind === 'none' ? (
        <span className="text-xs text-muted-foreground">{t('noSchema')}</span>
      ) : (
        KINDS[format.kind].map((kind) => (
          <Badge
            key={kind}
            variant="outline"
            className="border-primary/30 bg-primary/10 text-primary"
          >
            {t(`formats.${kind}`, { ns: 'common' })}
          </Badge>
        ))
      )}
      <span className="sr-only">{checked}</span>
    </div>
  )
}
