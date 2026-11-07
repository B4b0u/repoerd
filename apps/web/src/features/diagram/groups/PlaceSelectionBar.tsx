import { TABLE_GROUP_LIMITS } from '@repoerd/model'
import { X } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Button } from '../../../shared/ui/button'
import { IconButton } from '../../../shared/ui/IconButton'
import { Input } from '../../../shared/ui/input'
import { newGroupEdits } from './edits'
import { GroupSwatch } from './GroupSelect'
import { useGroupEditing } from './group-editing'
import { useGroupsTranslation } from './groups-i18n'

interface Props {
  /** The selected tables, at least one. */
  tables: string[]
  /** The tables were placed: they leave the selection (a refused placement keeps them). */
  onPlaced: (tables: string[]) => void
  /** Empties the selection (the bar's own button). */
  onClear: () => void
}

/**
 * The count of selected tables for assistive technologies: there before the first selection, so
 * that the first count is announced too (a live region inserted with its text is not).
 */
export function SelectionStatus({ count }: { count: number }) {
  const { t } = useGroupsTranslation()
  return (
    // A live region without the status role: the canvas's banners are the page's statuses.
    <div aria-live="polite" aria-atomic className="sr-only" data-selection-status>
      {count > 0 ? t('selection.count', { count }) : ''}
    </div>
  )
}

/**
 * The floating bar of the tables selected on the canvas: places them all in a group, out of any
 * group or in a new group, as one gesture with its "Undo" notice. Nothing without the editing
 * commands.
 */
export function PlaceSelectionBar({ tables, onPlaced, onClear }: Props) {
  const editing = useGroupEditing()
  const { t } = useGroupsTranslation()
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  // A placement is on its way: a second click would place the tables twice.
  const [placing, setPlacing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const newButton = useRef<HTMLButtonElement>(null)
  const wasCreating = useRef(false)
  useEffect(() => {
    if (creating) input.current?.focus()
    // The form is gone (cancelled) with the focus it held: back to the button that opened it.
    else if (wasCreating.current) newButton.current?.focus()
    wasCreating.current = creating
  }, [creating])
  if (!editing?.editable) return null

  const { view, edits, schema } = editing
  const count = tables.length
  const placed = (done: Promise<boolean>) => {
    setPlacing(true)
    void done
      .then((ok) => {
        if (ok) onPlaced(tables)
      })
      .finally(() => setPlacing(false))
  }
  const placeIn = (target: string | null, undoLabel: string) =>
    placed(edits.place(tables, target, { undoLabel }))
  const name = draft.trim()
  const create = (event: FormEvent) => {
    event.preventDefault()
    if (name === '') return
    setCreating(false)
    placed(
      edits.run((saved) => newGroupEdits(schema, saved, name, tables), {
        undoLabel: t('notices.placed', { count, name }),
      }),
    )
  }

  return (
    <div
      role="toolbar"
      aria-label={t('selection.toolbar')}
      className="absolute bottom-16 left-1/2 z-10 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-col gap-1.5 rounded-lg border bg-card p-1.5 text-sm shadow-md"
    >
      <div className="flex max-h-32 flex-wrap items-center gap-1 overflow-y-auto">
        <span className="px-2 font-medium">{t('selection.count', { count })}</span>
        <span className="pr-1 text-muted-foreground">{t('selection.placeInto')}</span>
        {view.groups.map((group) => (
          <Button
            key={group.id}
            variant="outline"
            size="sm"
            className="max-w-48"
            title={group.name}
            disabled={placing}
            onClick={() => placeIn(group.id, t('notices.placed', { count, name: group.name }))}
          >
            <GroupSwatch color={group.color} />
            <span className="truncate">{group.name}</span>
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={placing}
          onClick={() => placeIn(null, t('notices.ungrouped', { count }))}
        >
          {t('ungrouped')}
        </Button>
        <Button
          ref={newButton}
          variant="outline"
          size="sm"
          aria-expanded={creating}
          onClick={() => {
            setDraft('')
            setCreating(true)
          }}
        >
          {t('detail.newGroup')}
        </Button>
        <IconButton label={t('selection.clear')} onClick={onClear}>
          <X />
        </IconButton>
      </div>
      {creating && (
        <form onSubmit={create} className="flex gap-2">
          <Input
            ref={input}
            className="h-8"
            aria-label={t('detail.newName')}
            value={draft}
            maxLength={TABLE_GROUP_LIMITS.name}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              // Only the form closes: the selection stays.
              event.preventDefault()
              setCreating(false)
            }}
          />
          <Button type="submit" size="sm" disabled={name === '' || placing}>
            {t('detail.create')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
            {t('detail.cancel')}
          </Button>
        </form>
      )}
    </div>
  )
}
