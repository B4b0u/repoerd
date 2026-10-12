import { DiamondIcon, KeyIcon, LinkIcon } from '../../shared/ui/icons'

export function ColumnIcon({
  isPrimaryKey,
  isForeignKey,
  notNull,
}: {
  isPrimaryKey: boolean
  isForeignKey: boolean
  notNull: boolean
}) {
  if (isPrimaryKey) return <KeyIcon className="column-icon column-icon--key" />
  if (isForeignKey) return <LinkIcon className="column-icon column-icon--link" />
  return <DiamondIcon className="column-icon" filled={notNull} />
}
