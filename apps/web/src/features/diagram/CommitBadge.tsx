import { useTranslation } from 'react-i18next'
import { Badge } from '../../shared/ui/badge'

/** Short SHA of the displayed commit: a link to GitHub in real mode, plain text in fake mode. */
export function CommitBadge({ sha, url }: { sha: string; url: string | null }) {
  const { t } = useTranslation('diagram')
  const short = sha.slice(0, 7)
  if (!url) {
    return (
      <Badge variant="outline" className="font-mono text-muted-foreground" title={sha}>
        {short}
      </Badge>
    )
  }
  return (
    <Badge
      asChild
      variant="outline"
      className="font-mono text-muted-foreground no-underline hover:border-primary hover:text-primary"
    >
      <a href={url} target="_blank" rel="noreferrer" title={t('commit.open', { sha })}>
        {short}
      </a>
    </Badge>
  )
}
