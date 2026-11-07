import type { DisplayMode, RepoRef } from '@repoerd/model'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useGroupsTranslation } from './groups-i18n'

/**
 * Per repository, source and display mode: whether a layout was saved when the diagram of this
 * source first placed its tables. A canvas mounted again while the diagram stays open (another
 * mode, back from the related view) finds the positions it saved itself: they must not count as
 * a layout the user already had. Forgotten when the diagram is left (`forgetVisit`).
 */
const layoutAtFirstPlacement = new Map<string, boolean>()

const visitKey = (repo: RepoRef, sourceId: string) => `${repo.owner}/${repo.name}:${sourceId}:`

/** Whether the user had a saved layout before this visit placed any table of it. */
export function hadLayoutBeforeVisit(
  repo: RepoRef,
  sourceId: string,
  mode: DisplayMode,
  hasSavedPositions: boolean,
): boolean {
  const key = visitKey(repo, sourceId) + mode
  const known = layoutAtFirstPlacement.get(key)
  if (known !== undefined) return known
  layoutAtFirstPlacement.set(key, hasSavedPositions)
  return hasSavedPositions
}

/** The diagram of this source is left: a later visit reads its saved layouts afresh. */
export function forgetVisit(repo: RepoRef, sourceId: string) {
  const prefix = visitKey(repo, sourceId)
  for (const key of [...layoutAtFirstPlacement.keys()]) {
    if (key.startsWith(prefix)) layoutAtFirstPlacement.delete(key)
  }
}

const storageKey = (repo: RepoRef, sourceId: string) =>
  `repoerd:group-layout-offer:${repo.owner}/${repo.name}:${sourceId}`

/** Whether the offer was shown in this browser; undefined when the storage cannot be used. */
function wasShown(key: string): boolean | undefined {
  try {
    return window.localStorage.getItem(key) !== null
  } catch {
    return undefined
  }
}

function markShown(key: string) {
  try {
    window.localStorage.setItem(key, 'shown')
  } catch {
    // Not remembered: the offer may come back on a later visit.
  }
}

// A new id for every notice: a notice dismissed as the canvas unmounts must not take the next
// one (StrictMode mounts twice) with it.
let offers = 0

interface Props {
  repo: RepoRef
  sourceId: string
  /** Saved groups meet a layout the user had before this visit. */
  eligible: boolean
  /** Opens the confirmation of "Rearrange all tables", which lays the tables out by group. */
  onLayOut: () => void
}

/**
 * Offers once per browser, repository and source to lay out by group a diagram arranged before
 * its groups were saved: groups never move tables by themselves. Using or dismissing the notice
 * marks it as shown; leaving the diagram takes it away without marking it. Nothing is offered
 * when the browser storage cannot be used (it could not be remembered).
 */
export function GroupLayoutOffer({ repo, sourceId, eligible, onLayOut }: Props) {
  const { t } = useGroupsTranslation()
  const layOut = useRef(onLayOut)
  useEffect(() => {
    layOut.current = onLayOut
  })
  const key = storageKey(repo, sourceId)

  useEffect(() => {
    if (!eligible || wasShown(key) !== false) return
    const id = `group-layout-offer-${++offers}`
    let leaving = false
    toast(t('layoutOffer.message'), {
      id,
      duration: Number.POSITIVE_INFINITY,
      // On the canvas side: the other notices' corner (top right) is over the detail panel, whose
      // controls this one would hide until used or dismissed.
      position: 'bottom-left',
      // The text on its own line, the two buttons under it: the action's label is long.
      classNames: { toast: 'flex-wrap', content: 'basis-full!' },
      action: {
        label: t('layoutOffer.accept'),
        onClick: () => {
          markShown(key)
          layOut.current()
        },
      },
      cancel: { label: t('layoutOffer.decline'), onClick: () => markShown(key) },
      // A swipe; also the dismissal below, which must not count.
      onDismiss: () => {
        if (!leaving) markShown(key)
      },
    })
    return () => {
      leaving = true
      toast.dismiss(id)
    }
  }, [eligible, key, t])

  return null
}
