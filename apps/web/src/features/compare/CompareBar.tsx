import type { CompareResponse } from '@repoerd/contracts'
import type { CompareMode, DiffSummary, SchemaDiff } from '@repoerd/model'
import { ArrowLeftRight, ArrowRight, GitCompare, X } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { IconButton } from '../../shared/ui/IconButton'
import { CommitBadge } from '../diagram/CommitBadge'

interface Props {
  head: string
  base: string
  mode: CompareMode
  comparison: CompareResponse | undefined
  diff: SchemaDiff | null
  /** Undefined until the displayed branch is known. */
  onSwap?: () => void
  onExit: () => void
}

const CHIPS: readonly (readonly [keyof DiffSummary, string])[] = [
  ['tablesAdded', 'border-diff-added/40 text-diff-added'],
  ['tablesModified', 'border-diff-modified/40 text-diff-modified'],
  ['tablesRemoved', 'border-diff-removed/40 text-diff-removed'],
  ['enumsChanged', 'border-diff-modified/40 text-diff-modified'],
]

/** The comparison line under the toolbar: branches, commits read, summary, swap and exit. */
export function CompareBar({ head, base, mode, comparison, diff, onSwap, onExit }: Props) {
  const { t } = useTranslation('compare')
  return (
    <section
      aria-label={t('bar.label')}
      className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-4 py-1.5 text-sm"
    >
      <GitCompare className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">
        <Trans
          t={t}
          i18nKey="bar.branches"
          values={{ head, base }}
          tOptions={{ interpolation: { escapeValue: true } }}
          shouldUnescape
          components={{ strong: <strong /> }}
        />
      </span>
      <span className="text-muted-foreground">
        {mode === 'direct' ? t('bar.directly') : t('bar.sinceForkPoint')}
      </span>
      {comparison && (
        <span className="flex items-center gap-1">
          <CommitBadge sha={comparison.before.commitSha} url={comparison.before.commitUrl} />
          <ArrowRight className="size-3.5 text-muted-foreground" />
          <CommitBadge sha={comparison.after.commitSha} url={comparison.after.commitUrl} />
        </span>
      )}
      {diff &&
        CHIPS.map(
          ([key, tone]) =>
            diff.summary[key] > 0 && (
              <Badge key={key} variant="outline" className={tone}>
                {t(`summary.${key}`, { count: diff.summary[key] })}
              </Badge>
            ),
        )}
      <span className="flex-1" />
      <IconButton label={t('bar.swap')} onClick={onSwap} disabled={!onSwap}>
        <ArrowLeftRight />
      </IconButton>
      <Button variant="outline" size="sm" onClick={onExit}>
        <X />
        {t('bar.exit')}
      </Button>
    </section>
  )
}
