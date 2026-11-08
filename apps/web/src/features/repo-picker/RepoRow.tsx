import type { RepoDto } from '@repoerd/contracts'
import { useId } from 'react'
import { Link } from 'wouter'
import { FavoriteButton } from './FavoriteButton'
import { FormatBadge } from './FormatBadge'
import { DefaultBranch, PrivateLabel, repoHref } from './RepoCard'

/**
 * A repository in the full list: the star, then a link to its diagram over the rest of the row.
 * `showOwner` when no owner heading above says whose it is.
 */
export function RepoRow({
  repo,
  showOwner,
  onToggleFavorite,
}: {
  repo: RepoDto
  showOwner: boolean
  onToggleFavorite: (repo: RepoDto) => void
}) {
  const factsId = useId()
  return (
    <li className="flex items-center gap-1 pl-2 transition-colors hover:bg-accent/50 has-[a:focus-visible]:bg-accent/50">
      <FavoriteButton repo={repo} onToggle={onToggleFavorite} />
      <Link
        href={repoHref(repo)}
        aria-label={`${repo.owner}/${repo.name}`}
        aria-describedby={factsId}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-2.5 pr-4 pl-1 text-foreground no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <span className="min-w-0 flex-1 truncate font-medium">
          {showOwner && <span className="font-normal text-muted-foreground">{repo.owner}/</span>}
          {repo.name}
        </span>
        <div
          id={factsId}
          className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground sm:gap-4"
        >
          <div className="flex sm:w-36">
            <FormatBadge repo={repo} />
          </div>
          <div className="flex sm:w-16">{repo.private && <PrivateLabel compact />}</div>
          <DefaultBranch name={repo.defaultBranch} className="hidden w-28 sm:flex" />
        </div>
      </Link>
    </li>
  )
}
