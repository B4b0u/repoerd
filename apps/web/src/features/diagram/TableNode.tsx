import { Handle, type NodeProps, Position } from '@xyflow/react'
import { type CSSProperties, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeContext } from '../../shared/theme/theme-context'
import { TableIcon } from '../../shared/ui/icons'
import { ColumnIcon } from './ColumnIcon'
import type { GroupColors } from './groups/group-colors'
import { useGroupsTranslation } from './groups/groups-i18n'
import { changeOf, MARK } from './model/change-marks'
import { columnChangeTitle, type NodeDiff, typeChange } from './model/diff-view'
import { HEADER_HEIGHT, ROW_HEIGHT, TABLE_NAME_HEIGHT, TABLE_WIDTH } from './model/dimensions'
import { handleId, type TableFlowNode } from './model/to-flow'

function HubColumnBadge({ table }: { table: string }) {
  const { t } = useTranslation('diagram')
  const label = t('hub.badge', { table })
  return (
    <span className="table-node__hub-badge" title={label} role="img" aria-label={label}>
      →
    </span>
  )
}

/** On a table outside its group's frame: the group's name, since colour alone says nothing. */
function GroupTag({ name, colors }: { name: string; colors: GroupColors }) {
  const { t } = useGroupsTranslation()
  return (
    <span
      className="table-node__group-tag"
      title={t('tag', { name })}
      style={{ background: colors.label, color: colors.labelText }}
    >
      {name}
    </span>
  )
}

function columnTitle(column: { name: string; type: string; notNull: boolean; isUnique: boolean }) {
  const traits = [column.notNull ? 'NOT NULL' : 'NULL', column.isUnique ? 'UNIQUE' : null]
  return `${column.name}: ${column.type} (${traits.filter(Boolean).join(', ')})`
}

/** "New", "Removed", or the column counts of a modified table (comparison only). */
function DiffBadge({ diff }: { diff: NodeDiff }) {
  const { t } = useTranslation('compare')
  if (diff.status === 'unchanged') return null
  if (diff.status !== 'modified') {
    return (
      <span className={`table-node__diff-label table-node__diff-label--${diff.status}`}>
        {t(`card.${diff.status}`)}
      </span>
    )
  }
  const { added, modified, removed } = diff.counts
  return (
    <span className="table-node__diff-counts">
      <span aria-hidden="true">
        {added > 0 && <span className="table-node__diff-count--added">+{added}</span>}
        {modified > 0 && <span className="table-node__diff-count--modified">~{modified}</span>}
        {removed > 0 && <span className="table-node__diff-count--removed">−{removed}</span>}
        {added + modified + removed === 0 && (
          <span className="table-node__diff-count--modified">~</span>
        )}
      </span>
      <span className="sr-only">{t('card.counts', { added, modified, removed })}</span>
    </span>
  )
}

type CardProps = NodeProps<TableFlowNode>

function TableCard({ data, selected }: CardProps) {
  const { theme } = useThemeContext()
  const foreignKeys = new Set(data.foreignKeyColumns)
  const nameOnly = data.mode === 'TABLE_NAME'
  const classes = ['table-node', `table-node--${data.highlight}`]
  if (nameOnly) classes.push('table-node--name-only')
  if (data.diff) classes.push(`table-node--diff-${data.diff.status}`)
  if (selected) classes.push('table-node--selected')
  const colors = data.group?.colors[theme]
  if (colors) classes.push('table-node--grouped')
  return (
    <div
      className={classes.join(' ')}
      style={
        {
          width: TABLE_WIDTH,
          '--name-length': data.table.name.length,
          ...(colors ? { '--group-stroke': colors.stroke } : {}),
        } as CSSProperties
      }
    >
      <header
        className="table-node__header"
        style={{ height: nameOnly ? TABLE_NAME_HEIGHT : HEADER_HEIGHT }}
        title={data.table.comment ?? data.table.name}
      >
        <Handle
          type="target"
          position={Position.Left}
          id={handleId.tableTarget}
          className="table-node__handle"
          isConnectable={false}
        />
        <TableIcon className="table-node__header-icon" />
        <span className="table-node__title">{data.table.name}</span>
        {data.group?.far && colors && <GroupTag name={data.group.name} colors={colors} />}
        {data.diff && <DiffBadge diff={data.diff} />}
        <Handle
          type="source"
          position={Position.Right}
          id={handleId.tableSource}
          className="table-node__handle"
          isConnectable={false}
        />
      </header>
      {data.columns.length > 0 && (
        <ul className="table-node__columns">
          {data.columns.map((column) => {
            const change = data.diff?.columns[column.name]
            const status = changeOf(change?.status)
            const type = change ? typeChange(change) : null
            const title = [columnTitle(column), ...columnChangeTitle(change?.changes ?? [])]
            const hub = data.hubBadges?.[column.name]
            return (
              <li
                key={column.name}
                className={
                  status ? `table-node__column table-node__column--${status}` : 'table-node__column'
                }
                style={{ height: ROW_HEIGHT }}
                title={title.join('\n')}
              >
                <Handle
                  type="target"
                  position={Position.Left}
                  id={handleId.target(column.name)}
                  className="table-node__handle"
                  isConnectable={false}
                />
                {status && (
                  <span className="table-node__diff-mark" aria-hidden="true">
                    {MARK[status]}
                  </span>
                )}
                <span className="table-node__marks">
                  <ColumnIcon
                    isPrimaryKey={column.isPrimaryKey}
                    isForeignKey={foreignKeys.has(column.name)}
                    notNull={column.notNull}
                  />
                  {hub && <HubColumnBadge table={hub} />}
                </span>
                <span className="table-node__name">{column.name}</span>
                <span className="table-node__type">
                  {type ? `${type.before} → ${type.after}` : column.type}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={handleId.source(column.name)}
                  className="table-node__handle"
                  isConnectable={false}
                />
              </li>
            )
          })}
        </ul>
      )}
      <span className="table-node__overview-name" aria-hidden="true">
        {data.table.name}
        {data.diff && <DiffBadge diff={data.diff} />}
      </span>
    </div>
  )
}

/**
 * The card only shows its data and whether it is selected: the other props (`selectable`,
 * `draggable`, `dragging`, its position...) change without changing it, e.g. on every Shift press.
 */
export const sameCard = (a: CardProps, b: CardProps) =>
  a.data === b.data && a.selected === b.selected

export const TableNode = memo(TableCard, sameCard)
