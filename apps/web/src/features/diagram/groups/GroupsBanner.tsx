import type { DbSchema, RepoRef } from '@repoerd/model'
import { Button } from '../../../shared/ui/button'
import type { GroupView } from './group-view'
import { useGroupsTranslation } from './groups-i18n'
import { useGroupEdits } from './use-group-edits'

interface Props {
  repo: RepoRef
  sourceId: string
  schema: DbSchema
  view: GroupView
  /** Proposals shown again were replaced or given up: back to the saved groups. */
  onLeaveReproposal: () => void
}

/**
 * Says that the groups on the canvas are proposals. With the push right, offers to save them for
 * the team or to ignore them; once proposed again over saved groups, to replace those or to
 * give the proposals up.
 */
export function GroupsBanner({ repo, sourceId, schema, view, onLeaveReproposal }: Props) {
  const { t } = useGroupsTranslation()
  const { run, pending } = useGroupEdits(repo, sourceId, schema, view)
  // Groups saved meanwhile elsewhere are shown, not overwritten.
  const saveProposals = () =>
    run([{ kind: 'saveAll', groups: view.groups, assignments: {} }], { onlyUnconfigured: true })
  const ignoreProposals = () =>
    run([{ kind: 'saveAll', groups: [], assignments: {} }], { onlyUnconfigured: true })
  const replace = async () => {
    const done = await run([{ kind: 'saveAll', groups: view.groups, assignments: {} }], {
      undoLabel: t('replaced'),
    })
    // A refusal keeps the preview, so that the replacement can be tried again.
    if (done) onLeaveReproposal()
  }
  return (
    <div
      role="status"
      className="absolute top-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-lg border bg-card px-3.5 py-1.5 text-sm shadow-md"
    >
      <span>{t('proposed', { count: view.groups.length })}</span>
      {view.canEdit && (
        <span className="flex items-center gap-1.5">
          {view.reproposed ? (
            <>
              <Button size="xs" disabled={pending} onClick={() => void replace()}>
                {t('replaceForTeam')}
              </Button>
              <Button size="xs" variant="outline" disabled={pending} onClick={onLeaveReproposal}>
                {t('cancelProposal')}
              </Button>
            </>
          ) : (
            <>
              <Button size="xs" disabled={pending} onClick={() => void saveProposals()}>
                {t('saveForTeam')}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() => void ignoreProposals()}
              >
                {t('ignoreForTeam')}
              </Button>
            </>
          )}
        </span>
      )}
    </div>
  )
}
