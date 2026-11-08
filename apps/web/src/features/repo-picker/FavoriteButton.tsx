import type { RepoDto } from '@repoerd/contracts'
import { Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../shared/lib/utils'
import { IconButton } from '../../shared/ui/IconButton'

/** The star of a repository: a toggle button, always outside the repository's link. */
export function FavoriteButton({
  repo,
  onToggle,
  className,
}: {
  repo: RepoDto
  onToggle: (repo: RepoDto) => void
  className?: string
}) {
  const { t } = useTranslation('repos')
  const name = `${repo.owner}/${repo.name}`
  return (
    <IconButton
      label={t(repo.favorite ? 'removeFavorite' : 'addFavorite', { repo: name })}
      aria-pressed={repo.favorite}
      className={cn('text-muted-foreground hover:text-key aria-pressed:text-key', className)}
      onClick={() => onToggle(repo)}
    >
      <Star
        className={cn('transition-transform active:scale-90', repo.favorite && 'fill-current')}
      />
    </IconButton>
  )
}
