import type { RepoDto } from '@repoerd/contracts'
import { GitBranch, History, Lock } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'
import { toLanguage } from '../../shared/i18n/i18n'
import { cn } from '../../shared/lib/utils'
import { FavoriteButton } from './FavoriteButton'
import { FormatBadge } from './FormatBadge'
import { OwnerAvatar } from './OwnerAvatar'
import { formatRelative } from './relative-time'

export const repoHref = (repo: Pick<RepoDto, 'owner' | 'name'>) =>
  `/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`

/** "Private", reduced to its lock on narrow rows. */
export function PrivateLabel({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation('repos')
  return (
    <span className="flex items-center gap-1">
      <Lock className="size-3.5" />
      <span className={cn(compact && 'sr-only sm:not-sr-only')}>{t('private')}</span>
    </span>
  )
}

export function DefaultBranch({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1', className)}>
      <GitBranch className="size-3.5 shrink-0" />
      <span className="truncate font-mono">{name}</span>
    </span>
  )
}

/**
 * A repository as a card: the whole card links to its diagram, the star sits beside the link.
 * `opened` adds when its diagram was last opened (the recents).
 */
export function RepoCard({
  repo,
  opened = false,
  onToggleFavorite,
}: {
  repo: RepoDto
  opened?: boolean
  onToggleFavorite: (repo: RepoDto) => void
}) {
  const { t, i18n } = useTranslation('repos')
  const factsId = useId()
  return (
    <li className="relative">
      <Link
        href={repoHref(repo)}
        aria-label={`${repo.owner}/${repo.name}`}
        aria-describedby={factsId}
        className="flex h-full flex-col gap-1 rounded-xl border bg-card p-4 text-card-foreground no-underline shadow-sm outline-none transition-[border-color,box-shadow,translate] hover:-translate-y-px hover:border-primary/50 hover:shadow-md focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <div className="flex min-w-0 items-center gap-2 pr-8 text-xs text-muted-foreground">
          <OwnerAvatar owner={repo.owner} avatarUrl={repo.ownerAvatarUrl} />
          <span className="truncate">{repo.owner}</span>
        </div>
        <div className="truncate pr-8 text-base font-semibold tracking-tight">{repo.name}</div>
        <div
          id={factsId}
          className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground"
        >
          <FormatBadge repo={repo} />
          {repo.private && <PrivateLabel />}
          <DefaultBranch name={repo.defaultBranch} />
          {opened && repo.lastOpenedAt && (
            <span className="flex basis-full items-center gap-1">
              <History className="size-3.5" />
              {t('opened', {
                when: formatRelative(
                  new Date(repo.lastOpenedAt),
                  new Date(),
                  toLanguage(i18n.language),
                ),
              })}
            </span>
          )}
        </div>
      </Link>
      <FavoriteButton
        repo={repo}
        onToggle={onToggleFavorite}
        className="absolute top-2.5 right-2.5"
      />
    </li>
  )
}
