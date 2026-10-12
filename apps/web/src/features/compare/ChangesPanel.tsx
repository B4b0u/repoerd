import type { EnumDiff, SchemaDiff } from '@repoerd/model'
import type { TFunction } from 'i18next'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../shared/lib/utils'
import { Checkbox } from '../../shared/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../shared/ui/collapsible'
import { Label } from '../../shared/ui/label'
import { MARK, TONE } from '../diagram/model/change-marks'
import {
  type ChangedTable,
  type ChangeStatus,
  changedTables,
  tableChangeSummary,
} from '../diagram/model/diff-view'

const ENTRY =
  'flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50'
const HEADING = 'px-1.5 pt-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase'

interface Props {
  diff: SchemaDiff
  active?: string
  onlyChanged: boolean
  onOnlyChangedChange: (next: boolean) => void
  onSelect: (table: string) => void
}

function summaryText(t: TFunction<'compare'>, table: ChangedTable): string {
  if (table.status === 'added') return t('panel.newTable')
  if (table.status === 'removed') return t('panel.removedTable')
  const summary = tableChangeSummary(table)
  const { added, modified, removed } = summary.columns
  const columns = [
    added > 0 ? `+${added}` : '',
    modified > 0 ? `~${modified}` : '',
    removed > 0 ? `−${removed}` : '',
  ]
  return [
    columns.filter(Boolean).join(' '),
    summary.indexes > 0 ? t('panel.indexes', { count: summary.indexes }) : '',
    summary.constraints > 0 ? t('panel.constraints', { count: summary.constraints }) : '',
    summary.comment ? t('panel.comment') : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

function Mark({ status }: { status: ChangeStatus }) {
  return (
    <span aria-hidden="true" className={cn('w-3 shrink-0 text-center font-bold', TONE[status])}>
      {MARK[status]}
    </span>
  )
}

function EnumEntry({ change }: { change: EnumDiff }) {
  const { t } = useTranslation('compare')
  const [open, setOpen] = useState(false)
  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className={ENTRY}>
          <Mark status={change.status} />
          <span className="min-w-0 truncate font-medium">{change.name}</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {change.status === 'added'
              ? t('panel.newEnum')
              : change.status === 'removed'
                ? t('panel.removedEnum')
                : ''}
          </span>
          <ChevronRight
            className={cn(
              'ml-auto size-3.5 shrink-0 self-center text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-0.5 pb-1 pl-6.5 text-xs text-muted-foreground">
          {change.addedValues.length > 0 && (
            <p>{t('panel.valuesAdded', { values: change.addedValues.join(', ') })}</p>
          )}
          {change.removedValues.length > 0 && (
            <p>{t('panel.valuesRemoved', { values: change.removedValues.join(', ') })}</p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

/** Every change of a comparison; a click centres the table and opens its details. */
export function ChangesPanel({ diff, active, onlyChanged, onOnlyChangedChange, onSelect }: Props) {
  const { t } = useTranslation('compare')
  const tables = changedTables(diff)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2 px-0.5">
        <Checkbox
          id="changes-only-changed"
          checked={onlyChanged}
          onCheckedChange={(checked) => onOnlyChangedChange(checked === true)}
        />
        <Label htmlFor="changes-only-changed" className="text-sm font-normal">
          {t('panel.onlyChanged')}
        </Label>
      </div>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto">
        {tables.length > 0 && (
          <section aria-label={t('panel.tables')}>
            <h3 className={HEADING}>{t('panel.tables')}</h3>
            <ul>
              {tables.map((table) => (
                <li key={table.name}>
                  <button
                    type="button"
                    aria-current={table.name === active ? 'true' : undefined}
                    onClick={() => onSelect(table.name)}
                    className={cn(ENTRY, table.name === active && 'bg-accent')}
                  >
                    <Mark status={table.status} />
                    <span
                      className={cn(
                        'min-w-0 truncate font-medium',
                        table.status === 'removed' && 'line-through',
                      )}
                    >
                      {table.name}
                    </span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {summaryText(t, table)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {diff.enums.length > 0 && (
          <section aria-label={t('panel.enums')}>
            <h3 className={HEADING}>{t('panel.enums')}</h3>
            <ul>
              {diff.enums.map((change) => (
                <EnumEntry key={change.name} change={change} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
