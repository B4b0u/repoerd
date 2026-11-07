import { GROUP_PALETTE, TABLE_GROUP_LIMITS, type TableGroup } from '@repoerd/model'
import { Check, Trash2 } from 'lucide-react'
import { type ComponentProps, type FormEvent, useId, useState } from 'react'
import { Button } from '../../../shared/ui/button'
import { Input } from '../../../shared/ui/input'
import { Label } from '../../../shared/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover'
import { contrastRatio } from './group-colors'
import type { GroupEditing } from './group-editing'
import { useGroupsTranslation } from './groups-i18n'

/** Black or white, whichever reads better on the swatch. */
const checkColor = (swatch: string) =>
  contrastRatio(swatch, '#000000') >= contrastRatio(swatch, '#ffffff') ? '#000000' : '#ffffff'

interface Props extends Omit<ComponentProps<'button'>, 'type'> {
  group: TableGroup
  editing: GroupEditing
}

/**
 * A frame label as a button (`nopan`: pressing it must not pan the canvas) that opens the
 * group's editor: name, colour, deletion. The editor is a portal, at its usual size whatever
 * the zoom. Each change reads the group from the cache when it runs, so that it keeps what
 * another gesture changed meanwhile.
 */
export function GroupLabelEditor({ group, editing, className, children, ...button }: Props) {
  const { t } = useGroupsTranslation()
  const ids = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(group.name)
  const name = draft.trim()
  const color = group.color.toLowerCase()

  const onOpenChange = (next: boolean) => {
    if (next) setDraft(group.name)
    setOpen(next)
  }

  const save = (change: Pick<TableGroup, 'name'> | Pick<TableGroup, 'color'>) =>
    void editing.edits.run((current) => {
      const saved = current.groups.find((g) => g.id === group.id)
      return saved ? [{ kind: 'saveGroup', group: { ...saved, ...change } }] : []
    })

  const rename = (event: FormEvent) => {
    event.preventDefault()
    if (name === '') return
    setOpen(false)
    if (name !== group.name) save({ name })
  }

  const recolor = (next: string) => {
    if (next.toLowerCase() !== color) save({ color: next.toLowerCase() })
  }

  const remove = () => {
    setOpen(false)
    void editing.edits.run(
      (current) =>
        current.groups.some((g) => g.id === group.id)
          ? [{ kind: 'deleteGroup', groupId: group.id }]
          : [],
      { undoLabel: t('notices.deleted', { name: group.name }) },
    )
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          {...button}
          className={`${className ?? ''} nopan`}
          aria-label={t('editor.open', { name: group.name })}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={t('editor.open', { name: group.name })}
        className="flex w-64 flex-col gap-3"
      >
        <form onSubmit={rename} className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-name`}>{t('editor.name')}</Label>
          <div className="flex gap-2">
            <Input
              id={`${ids}-name`}
              className="h-8"
              value={draft}
              maxLength={TABLE_GROUP_LIMITS.name}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={name === ''}>
              {t('editor.rename')}
            </Button>
          </div>
        </form>
        <fieldset className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">{t('editor.color')}</legend>
          <div className="grid grid-cols-6 gap-1.5">
            {GROUP_PALETTE.map((swatch, index) => {
              const pressed = swatch === color
              return (
                <button
                  key={swatch}
                  type="button"
                  aria-label={t('editor.swatch', { n: index + 1 })}
                  aria-pressed={pressed}
                  title={swatch}
                  onClick={() => recolor(swatch)}
                  className="flex size-7 items-center justify-center rounded-full border border-black/20 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:ring-offset-2 aria-pressed:ring-offset-popover"
                  style={{ background: swatch }}
                >
                  {pressed && (
                    <Check aria-hidden className="size-4" style={{ color: checkColor(swatch) }} />
                  )}
                </button>
              )
            })}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="color"
              key={color}
              defaultValue={color}
              className="h-7 w-10 cursor-pointer rounded border bg-transparent"
              // The native "change" fires once the picker is closed, not at every hue it crosses.
              ref={(input) => {
                if (!input) return
                const commit = () => recolor(input.value)
                input.addEventListener('change', commit)
                return () => input.removeEventListener('change', commit)
              }}
            />
            {t('editor.custom')}
          </label>
        </fieldset>
        <div className="flex flex-col gap-1 border-t pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-start text-destructive hover:text-destructive"
            aria-describedby={`${ids}-delete-hint`}
            onClick={remove}
          >
            <Trash2 aria-hidden />
            {t('editor.delete')}
          </Button>
          <p id={`${ids}-delete-hint`} className="text-xs text-muted-foreground">
            {t('editor.deleteHint')}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
