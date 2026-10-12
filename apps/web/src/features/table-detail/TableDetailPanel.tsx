import type { DbSchema, DiffStatus, FieldChange, ItemDiff, TableDiff } from '@repoerd/model'
import { ChevronRight, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../shared/lib/utils'
import { Badge } from '../../shared/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../shared/ui/collapsible'
import { IconButton } from '../../shared/ui/IconButton'
import { TableIcon } from '../../shared/ui/icons'
import { ColumnIcon } from '../diagram/ColumnIcon'
import { changeOf, MARK, TONE } from '../diagram/model/change-marks'
import { foreignKeyColumns } from '../diagram/model/display-mode'
import { type AnyField, type DisplayValue, displayValue } from './diff-format'
import { type ColumnTrait, columnTraits, describeConstraint } from './format'

interface Props {
  schema: DbSchema
  tableName: string
  onClose: () => void
  /** Content of the "Related tables" section. */
  children?: ReactNode
  /** Comparison: what changed in this table (`schema` is the union of both sides). */
  diff?: TableDiff
}

const TRAIT_STYLES: Record<ColumnTrait, string> = {
  primaryKey: 'border-key/40 text-key',
  foreignKey: 'border-primary/40 text-primary',
  unique: '',
  notNull: '',
  nullable: 'text-muted-foreground',
}
const byName = <F extends string>(items: readonly ItemDiff<F>[] | undefined) =>
  new Map((items ?? []).map((item) => [item.name, item] as const))

function Section({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50">
        <ChevronRight
          className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        {title}
        {count !== undefined && (
          <Badge variant="secondary" className="ml-auto tabular-nums">
            {count}
          </Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 px-4 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  )
}

/** The status of a column, index or constraint: a symbol, and its name for screen readers. */
function ChangeMark({ status }: { status: DiffStatus | undefined }) {
  const { t } = useTranslation('compare')
  const change = changeOf(status)
  if (!change) return null
  return (
    <>
      <span aria-hidden="true" className={cn('w-3 shrink-0 text-center font-bold', TONE[change])}>
        {MARK[change]}
      </span>
      <span className="sr-only">{t(`status.${change}`)}</span>
    </>
  )
}

function useValueText() {
  const { t } = useTranslation('compare')
  const { t: tDetail } = useTranslation('detail')
  return (value: DisplayValue): string =>
    value.kind === 'text'
      ? value.text
      : value.kind === 'key'
        ? t(`values.${value.key}`)
        : tDetail(`constraintKinds.${value.key}`)
}

/** "Field: before → after" for each changed field. */
function FieldChanges({ changes }: { changes: readonly FieldChange<AnyField>[] }) {
  const { t } = useTranslation('compare')
  const text = useValueText()
  if (changes.length === 0) return null
  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {changes.map((change) => (
        <li key={change.field} className="wrap-anywhere">
          <span className="text-muted-foreground">{t(`fields.${change.field}`)}</span>{' '}
          <del className="font-mono text-muted-foreground">
            {text(displayValue(change.field, change.before))}
          </del>
          {' → '}
          <ins className="font-mono text-diff-modified no-underline">
            {text(displayValue(change.field, change.after))}
          </ins>
        </li>
      ))}
    </ul>
  )
}

export function TableDetailPanel({ schema, tableName, onClose, children, diff }: Props) {
  const { t } = useTranslation('detail')
  const { t: tCompare } = useTranslation('compare')
  // Own keys only: a URL naming "constructor" must not reach Object's members.
  const table = Object.hasOwn(schema.tables, tableName) ? schema.tables[tableName] : undefined
  if (!table) return null
  const foreignKeys = new Set(foreignKeyColumns(table))
  const status = changeOf(diff?.status)
  const columnDiffs = byName(diff?.columns)
  const indexDiffs = byName(diff?.indexes)
  const constraintDiffs = byName(diff?.constraints)

  return (
    <aside
      aria-label={t('label', { table: table.name })}
      className="absolute inset-y-0 right-0 z-20 flex w-90 max-w-full shrink-0 flex-col border-l bg-card shadow-lg xl:static xl:z-auto xl:shadow-none"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <TableIcon className="shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate font-semibold" title={table.name}>
          {table.name}
        </h2>
        {status && (
          <Badge variant="outline" className={TONE[status]}>
            {tCompare(`card.${status}`)}
          </Badge>
        )}
        <IconButton label={t('close')} onClick={onClose}>
          <X />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {diff?.comment ? (
          <p className="border-b px-4 py-3 text-sm wrap-anywhere">
            <span className="text-muted-foreground">{tCompare('fields.comment')}</span>{' '}
            <del className="text-muted-foreground">
              {diff.comment.before ?? tCompare('values.none')}
            </del>
            {' → '}
            <ins className="text-diff-modified no-underline">
              {diff.comment.after ?? tCompare('values.none')}
            </ins>
          </p>
        ) : (
          table.comment && (
            <p className="border-b px-4 py-3 text-sm text-muted-foreground">{table.comment}</p>
          )
        )}

        <Section title={t('sections.columns')} count={table.columns.length}>
          {table.columns.map((column) => {
            const change = columnDiffs.get(column.name)
            return (
              <div key={column.name} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <ChangeMark status={change?.status} />
                  <ColumnIcon
                    isPrimaryKey={column.isPrimaryKey}
                    isForeignKey={foreignKeys.has(column.name)}
                    notNull={column.notNull}
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm font-medium',
                      change?.status === 'removed' && 'line-through',
                    )}
                  >
                    {column.name}
                  </span>
                  <code
                    title={column.type}
                    className="min-w-0 shrink truncate font-mono text-xs text-muted-foreground"
                  >
                    {column.type}
                  </code>
                </div>
                <div className="flex flex-wrap gap-1">
                  {columnTraits(column, foreignKeys.has(column.name)).map((trait) => (
                    <Badge key={trait} variant="outline" className={TRAIT_STYLES[trait]}>
                      {t(`traits.${trait}`)}
                    </Badge>
                  ))}
                </div>
                {column.default !== null && (
                  <p className="text-xs text-muted-foreground">
                    {t('default')}{' '}
                    <code className="font-mono text-foreground">{column.default}</code>
                  </p>
                )}
                {column.comment && (
                  <p className="text-xs text-muted-foreground">{column.comment}</p>
                )}
                <FieldChanges changes={change?.changes ?? []} />
              </div>
            )
          })}
        </Section>

        <Section title={t('sections.indexes')} count={table.indexes.length}>
          {table.indexes.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('noIndex')}</p>
          )}
          {table.indexes.map((index) => {
            const change = indexDiffs.get(index.name)
            return (
              <div key={index.name} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <ChangeMark status={change?.status} />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm font-medium',
                      change?.status === 'removed' && 'line-through',
                    )}
                  >
                    {index.name}
                  </span>
                  {index.unique && <Badge variant="outline">{t('traits.unique')}</Badge>}
                  {index.type && (
                    <Badge variant="secondary" className="font-mono">
                      {index.type}
                    </Badge>
                  )}
                </div>
                <code className="font-mono text-xs text-muted-foreground">
                  {index.columns.join(', ')}
                </code>
                <FieldChanges changes={change?.changes ?? []} />
              </div>
            )
          })}
        </Section>

        <Section title={t('sections.constraints')} count={table.constraints.length}>
          {table.constraints.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('noConstraint')}</p>
          )}
          {table.constraints.map((constraint) => {
            const described = describeConstraint(constraint)
            const change = constraintDiffs.get(constraint.name)
            return (
              <div key={`${constraint.kind}:${constraint.name}`} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <ChangeMark status={change?.status} />
                  <Badge variant="outline">{t(`constraintKinds.${described.kind}`)}</Badge>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm font-medium',
                      change?.status === 'removed' && 'line-through',
                    )}
                  >
                    {described.name}
                  </span>
                </div>
                <code className="font-mono text-xs wrap-anywhere text-muted-foreground">
                  {described.detail}
                </code>
                <FieldChanges changes={change?.changes ?? []} />
              </div>
            )
          })}
        </Section>

        {children && <Section title={t('sections.related')}>{children}</Section>}
      </div>
    </aside>
  )
}
