import { TABLE_GROUP_LIMITS } from '@repoerd/model'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { useThemeContext } from '../../../shared/theme/theme-context'
import { Button } from '../../../shared/ui/button'
import { Input } from '../../../shared/ui/input'
import { Label } from '../../../shared/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui/select'
import { newGroupEdits } from './edits'
import { groupColors } from './group-colors'
import { isPlacedByHand, useGroupEditing } from './group-editing'
import { useGroupsTranslation } from './groups-i18n'

const ORIGIN = 'origin'
const NONE = 'none'
const NEW = 'new'
const GROUP = 'group:'

/** The colour dot of a group, beside its name (never alone). */
export function GroupSwatch({ color }: { color: string }) {
  const { theme } = useThemeContext()
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full"
      style={{ background: groupColors(color, theme).stroke }}
    />
  )
}

/**
 * The group of a table, in its details. With the editing commands, a selector places it in
 * another group, out of any group, back to its file (once placed by hand), or in a new group;
 * otherwise the group's name. Nothing outside the diagram workspace, or until the groups load.
 */
export function GroupSelect({ table }: { table: string }) {
  const editing = useGroupEditing()
  const { t } = useGroupsTranslation()
  const ids = useId()
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const wasCreating = useRef(false)
  useEffect(() => {
    // The selector gives the focus back to its trigger when it closes: the new name's field takes it.
    if (creating) input.current?.focus()
    // The form is gone (created, cancelled) with the focus it held: back to the selector.
    else if (wasCreating.current) trigger.current?.focus()
    wasCreating.current = creating
  }, [creating])
  if (!editing || editing.saved === undefined) return null

  const { view, edits, schema } = editing
  const groupId = view.membership.get(table) ?? null
  const current = groupId === null ? undefined : view.groups.find((g) => g.id === groupId)
  const label = t('detail.label')

  if (!editing.editable) {
    return (
      <p className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        {current ? (
          <>
            <GroupSwatch color={current.color} />
            <span className="min-w-0 truncate" title={current.name}>
              {current.name}
            </span>
          </>
        ) : (
          <span>{t('ungrouped')}</span>
        )}
      </p>
    )
  }

  const choose = (value: string) => {
    setCreating(value === NEW)
    if (value === NEW) {
      setDraft('')
    } else if (value === ORIGIN) {
      void edits.place([table], 'origin', { undoLabel: t('notices.followFile', { count: 1 }) })
    } else if (value === NONE) {
      void edits.place([table], null, { undoLabel: t('notices.ungrouped', { count: 1 }) })
    } else {
      const target = view.groups.find((g) => `${GROUP}${g.id}` === value)
      if (!target) return
      void edits.place([table], target.id, {
        undoLabel: t('notices.placed', { count: 1, name: target.name }),
      })
    }
  }

  const name = draft.trim()
  const create = (event: FormEvent) => {
    event.preventDefault()
    if (name === '') return
    setCreating(false)
    void edits.run((saved) => newGroupEdits(schema, saved, name, [table]), {
      undoLabel: t('notices.placed', { count: 1, name }),
    })
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b px-4 py-2">
      <div className="flex items-center gap-2">
        <Label htmlFor={`${ids}-group`} className="text-sm font-normal text-muted-foreground">
          {label}
        </Label>
        <Select value={current ? `${GROUP}${current.id}` : NONE} onValueChange={choose}>
          <SelectTrigger ref={trigger} id={`${ids}-group`} size="sm" className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            position="popper"
            onCloseAutoFocus={(event) => {
              if (creating) event.preventDefault()
            }}
          >
            {isPlacedByHand(editing, table) && (
              <SelectItem value={ORIGIN}>{t('detail.followFile')}</SelectItem>
            )}
            {view.groups.map((group) => (
              <SelectItem key={group.id} value={`${GROUP}${group.id}`}>
                <GroupSwatch color={group.color} />
                <span className="truncate">{group.name}</span>
              </SelectItem>
            ))}
            <SelectItem value={NONE}>{t('ungrouped')}</SelectItem>
            <SelectItem value={NEW}>{t('detail.newGroup')}</SelectItem>
          </SelectContent>
        </Select>
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
              if (event.key === 'Escape') setCreating(false)
            }}
          />
          <Button type="submit" size="sm" disabled={name === ''}>
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
