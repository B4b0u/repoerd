import type { DbSchema } from '@repoerd/model'
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../shared/lib/utils'
import { useThemeContext } from '../../shared/theme/theme-context'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { Checkbox } from '../../shared/ui/checkbox'
import { IconButton } from '../../shared/ui/IconButton'
import { Input } from '../../shared/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/tabs'
import { groupColors } from '../diagram/groups/group-colors'
import type { GroupView } from '../diagram/groups/group-view'
import { useGroupsTranslation } from '../diagram/groups/groups-i18n'
import { filterTables } from './filter-tables'

interface Props {
  schema: DbSchema
  hidden: ReadonlySet<string>
  active?: string
  onToggle: (table: string) => void
  onShowAll: () => void
  onHideAll: () => void
  onSelect: (table: string) => void
  /** Sections per group, then the ungrouped tables; the plain list when there is no group. */
  groups?: GroupView
  /** Shows or hides several tables at once (a group's checkbox), in one update. */
  onSetHidden?: (tables: string[], hidden: boolean) => void
  /** Comparison: a first tab with the changes; the table list becomes the second tab. */
  changes?: { label: string; content: ReactNode }
}

export function TableListPane({
  schema,
  hidden,
  active,
  onToggle,
  onShowAll,
  onHideAll,
  onSelect,
  groups,
  onSetHidden,
  changes,
}: Props) {
  const { t } = useTranslation('tables')
  const { t: tGroups } = useGroupsTranslation()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set())
  const { theme } = useThemeContext()
  const names = useMemo(() => Object.keys(schema.tables).sort(), [schema])
  const shown = filterTables(names, query)
  const visible = names.length - hidden.size
  const sections = useMemo(() => {
    if (!groups || groups.groups.length === 0) return null
    const known = new Set(groups.groups.map((group) => group.id))
    const idOf = (name: string) => {
      const id = groups.membership.get(name) ?? null
      return id !== null && known.has(id) ? id : null
    }
    const result = groups.groups.map((group) => ({
      id: group.id as string | null,
      name: group.name,
      color: group.color as string | null,
      tables: names.filter((name) => idOf(name) === group.id),
    }))
    const rest = names.filter((name) => idOf(name) === null)
    if (rest.length > 0) result.push({ id: null, name: '', color: null, tables: rest })
    return result
  }, [groups, names])

  if (collapsed) {
    return (
      <aside
        aria-label={t('title')}
        className="flex w-11 shrink-0 flex-col items-center border-r bg-card py-2"
      >
        <IconButton label={t('expand')} onClick={() => setCollapsed(false)}>
          <PanelLeftOpen />
        </IconButton>
      </aside>
    )
  }

  const renderRow = (name: string) => {
    const isHidden = hidden.has(name)
    const isActive = name === active
    return (
      <li
        key={name}
        className={cn('flex items-center gap-2 rounded-md px-1.5 py-0.5', isActive && 'bg-accent')}
      >
        <Checkbox
          checked={!isHidden}
          aria-label={t('show', { table: name })}
          onCheckedChange={() => onToggle(name)}
        />
        <button
          type="button"
          title={name}
          aria-current={isActive ? 'true' : undefined}
          onClick={() => onSelect(name)}
          className={cn(
            'min-w-0 flex-1 truncate rounded-sm px-1 py-1 text-left text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
            isHidden ? 'text-muted-foreground' : 'text-foreground',
            isActive && 'font-medium text-primary',
          )}
        >
          {name}
        </button>
      </li>
    )
  }

  const list = (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          className="h-8 pl-8"
          placeholder={t('search')}
          aria-label={t('search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="xs"
          className="flex-1"
          onClick={onShowAll}
          disabled={hidden.size === 0}
        >
          <Eye />
          {t('showAll')}
        </Button>
        <Button
          variant="outline"
          size="xs"
          className="flex-1"
          onClick={onHideAll}
          disabled={hidden.size === names.length}
        >
          <EyeOff />
          {t('hideAll')}
        </Button>
      </div>
      <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto">
        {sections
          ? sections.map((section) => {
              const matching = section.tables.filter((name) => shown.includes(name))
              if (matching.length === 0) return null
              const key = section.id ?? ''
              return (
                <GroupSection
                  key={key || 'ungrouped'}
                  name={section.id === null ? tGroups('ungrouped') : section.name}
                  color={section.color === null ? null : groupColors(section.color, theme).stroke}
                  tables={section.tables}
                  hidden={hidden}
                  collapsed={collapsedGroups.has(key)}
                  onCollapse={() =>
                    setCollapsedGroups((current) => {
                      const next = new Set(current)
                      if (!next.delete(key)) next.add(key)
                      return next
                    })
                  }
                  onSetHidden={onSetHidden}
                >
                  {matching.map(renderRow)}
                </GroupSection>
              )
            })
          : shown.map(renderRow)}
        {shown.length === 0 && (
          <li className="px-2 py-3 text-sm text-muted-foreground">{t('noMatch')}</li>
        )}
      </ul>
    </>
  )

  return (
    <aside
      aria-label={t('title')}
      className="flex w-65 shrink-0 flex-col gap-2 border-r bg-card p-3"
    >
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {t('title')}
          <Badge variant="secondary" className="tabular-nums">
            <span aria-hidden>
              {visible}/{names.length}
            </span>
            <span className="sr-only">{t('visibleCount', { visible, total: names.length })}</span>
          </Badge>
        </span>
        <IconButton label={t('collapse')} onClick={() => setCollapsed(true)}>
          <PanelLeftClose />
        </IconButton>
      </header>
      {changes ? (
        <Tabs defaultValue="changes" className="min-h-0 flex-1">
          <TabsList className="w-full">
            <TabsTrigger value="changes">{changes.label}</TabsTrigger>
            <TabsTrigger value="tables">{t('title')}</TabsTrigger>
          </TabsList>
          <TabsContent value="changes" className="flex min-h-0 flex-col">
            {changes.content}
          </TabsContent>
          <TabsContent value="tables" className="flex min-h-0 flex-col gap-2">
            {list}
          </TabsContent>
        </Tabs>
      ) : (
        list
      )}
    </aside>
  )
}

interface SectionProps {
  name: string
  /** Null for the ungrouped tables. */
  color: string | null
  tables: string[]
  hidden: ReadonlySet<string>
  collapsed: boolean
  onCollapse: () => void
  onSetHidden?: (tables: string[], hidden: boolean) => void
  children: ReactNode
}

function GroupSection({
  name,
  color,
  tables,
  hidden,
  collapsed,
  onCollapse,
  onSetHidden,
  children,
}: SectionProps) {
  const { t } = useGroupsTranslation()
  const hiddenCount = tables.filter((table) => hidden.has(table)).length
  const state = hiddenCount === 0 ? true : hiddenCount === tables.length ? false : 'indeterminate'
  return (
    <li>
      <section aria-label={name}>
        <div className="flex items-center gap-1.5 px-1.5 pt-2 pb-0.5">
          {/* The whole group, even the rows a search filters out: the heading counts them all. */}
          <Checkbox
            checked={state}
            aria-label={t('showGroup', { name })}
            onCheckedChange={() => onSetHidden?.(tables, state === true)}
          />
          <h3 className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold">
            {color !== null && (
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: color }}
              />
            )}
            <span className="truncate" title={name}>
              {name}
            </span>
            <span className="font-normal text-muted-foreground tabular-nums">{tables.length}</span>
          </h3>
          <IconButton
            label={t(collapsed ? 'expandGroup' : 'collapseGroup', { name })}
            aria-expanded={!collapsed}
            onClick={onCollapse}
          >
            {collapsed ? <ChevronRight /> : <ChevronDown />}
          </IconButton>
        </div>
        {!collapsed && <ul>{children}</ul>}
      </section>
    </li>
  )
}
