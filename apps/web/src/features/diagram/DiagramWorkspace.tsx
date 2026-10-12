import type { DbSchema, DisplayMode, RepoRef, SchemaDiff } from '@repoerd/model'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motionDuration } from '../../shared/lib/motion'
import { ChangesPanel } from '../compare/ChangesPanel'
import { TableDetailPanel } from '../table-detail/TableDetailPanel'
import { TableListPane } from '../table-list/TableListPane'
import { DiagramCanvas } from './DiagramCanvas'
import { relatedTableNames } from './layout/related'
import { canvasHiddenTables, changedTables } from './model/diff-view'
import { defaultDisplayMode } from './model/display-mode'
import { hiddenPatch, resolveViewTables, revealPatch } from './model/view-tables'
import { RelatedCanvas } from './RelatedCanvas'
import { RelatedTablesPreview } from './RelatedTablesPreview'
import type { ViewState, ViewStateUpdate } from './view-state'

interface Props {
  repo: RepoRef
  schema: DbSchema
  sourceId: string
  /** The branch has a single source: an empty layout may inherit a moved source's (spec §6.1). */
  inheritLayout?: boolean
  viewState: ViewState
  updateView: ViewStateUpdate
  /** Comparison: `schema` is the union of both sides and this says what changed. */
  diff?: SchemaDiff
  /**
   * Table count the default display mode is chosen from; the schema's own when absent. A
   * comparison passes the compared branch's, so it opens in the mode the branch has alone.
   */
  defaultModeTableCount?: number
}

export function DiagramWorkspace(props: Props) {
  // One React Flow store for the whole workspace, so the side panes can drive the canvas.
  return (
    <ReactFlowProvider>
      <Workspace {...props} />
    </ReactFlowProvider>
  )
}

function Workspace({
  repo,
  schema,
  sourceId,
  inheritLayout,
  viewState,
  updateView,
  diff,
  defaultModeTableCount,
}: Props) {
  const flow = useReactFlow()
  const mode =
    viewState.mode ?? defaultDisplayMode(defaultModeTableCount ?? Object.keys(schema.tables).length)
  const names = useMemo(() => Object.keys(schema.tables), [schema])
  // The hidden and shown lists are new arrays on every render: memoise on their content instead.
  const hiddenKey = viewState.hidden.join('\n')
  const shownKey = viewState.shown?.join('\n')
  const tables = useMemo(
    () =>
      resolveViewTables(schema, {
        active: viewState.active,
        focus: viewState.focus,
        hidden: hiddenKey ? hiddenKey.split('\n') : [],
        shown: shownKey === undefined ? undefined : shownKey ? shownKey.split('\n') : [],
        compact: viewState.compact,
      }),
    [schema, viewState.active, viewState.focus, viewState.compact, hiddenKey, shownKey],
  )
  const { t } = useTranslation('compare')
  const changedOnly = viewState.changed === true
  // Leaving the related view remounts the full canvas: it centres the table once placed.
  const [centerAfterRemount, setCenterAfterRemount] = useState<string>()
  const canvasHidden = useMemo(
    () => canvasHiddenTables(tables.hidden, diff, changedOnly),
    [tables.hidden, diff, changedOnly],
  )

  const changeMode = (next: DisplayMode) => updateView({ mode: next }, { replace: true })
  const activate = (table: string | undefined) => updateView({ active: table })
  // Opening a table's related view shows it, even if it was hidden.
  const openRelated = (table: string) => {
    setCenterAfterRemount(undefined)
    updateView({ focus: table, active: table, ...revealPatch(names, tables.hidden, table) })
  }
  const backToFullSchema = () => {
    setCenterAfterRemount(undefined)
    updateView({ focus: undefined })
  }
  const setHidden = (hidden: ReadonlySet<string>) =>
    updateView(hiddenPatch(names, hidden), { replace: true })
  // A table hidden as unchanged cannot be shown otherwise: leave "only changed tables".
  const hiddenAsUnchanged = (table: string) =>
    changedOnly &&
    diff !== undefined &&
    Object.hasOwn(diff.tables, table) &&
    diff.tables[table]?.status === 'unchanged'
  const toggle = (table: string) => {
    if (canvasHidden.has(table)) {
      updateView(
        hiddenAsUnchanged(table)
          ? { changed: undefined }
          : revealPatch(names, tables.hidden, table),
        { replace: true },
      )
    } else setHidden(new Set([...tables.hidden, table]))
  }
  const showAll = () =>
    updateView({ ...hiddenPatch(names, new Set()), changed: undefined }, { replace: true })
  const select = (table: string) => {
    const inView = !tables.focus || relatedTableNames(schema, tables.focus).includes(table)
    updateView({
      active: table,
      ...revealPatch(names, tables.hidden, table),
      ...(inView ? {} : { focus: undefined }),
      ...(hiddenAsUnchanged(table) ? { changed: undefined } : {}),
    })
    if (inView) {
      window.requestAnimationFrame(() => {
        void flow.fitView({ nodes: [{ id: table }], duration: motionDuration(300), maxZoom: 1 })
      })
    } else setCenterAfterRemount(table)
  }

  return (
    <div className="absolute inset-0 flex">
      <TableListPane
        schema={schema}
        hidden={canvasHidden}
        active={tables.active}
        onToggle={toggle}
        onShowAll={showAll}
        onHideAll={() => setHidden(new Set(names))}
        onSelect={select}
        changes={
          diff && {
            label: t('panel.tab', { count: changedTables(diff).length + diff.enums.length }),
            content: (
              <ChangesPanel
                diff={diff}
                active={tables.active}
                onlyChanged={changedOnly}
                onOnlyChangedChange={(next) =>
                  updateView({ changed: next || undefined }, { replace: true })
                }
                onSelect={select}
              />
            ),
          }
        }
      />
      <div className="relative min-w-0 flex-1">
        {tables.focus ? (
          <RelatedCanvas
            key={`${tables.focus}:${mode}`}
            schema={schema}
            focus={tables.focus}
            mode={mode}
            onModeChange={changeMode}
            active={tables.active}
            hidden={canvasHidden}
            diff={diff}
            onActivate={activate}
            onBack={backToFullSchema}
          />
        ) : (
          <DiagramCanvas
            key={mode}
            repo={repo}
            schema={schema}
            sourceId={sourceId}
            inheritLayout={inheritLayout}
            mode={mode}
            onModeChange={changeMode}
            active={tables.active}
            hidden={canvasHidden}
            diff={diff}
            onActivate={activate}
            centerOn={centerAfterRemount}
            onCentered={() => setCenterAfterRemount(undefined)}
          />
        )}
      </div>
      {tables.active && (
        <TableDetailPanel
          schema={schema}
          tableName={tables.active}
          onClose={() => activate(undefined)}
          diff={diff?.tables[tables.active]}
        >
          <RelatedTablesPreview
            schema={schema}
            table={tables.active}
            diff={diff}
            onOpen={() => openRelated(tables.active as string)}
          />
        </TableDetailPanel>
      )}
    </div>
  )
}
