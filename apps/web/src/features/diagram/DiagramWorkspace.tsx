import {
  type DbSchema,
  type DisplayMode,
  proposeGroups,
  type RepoRef,
  relationshipStatus,
  type SchemaDiff,
} from '@repoerd/model'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motionDuration } from '../../shared/lib/motion'
import { ChangesPanel } from '../compare/ChangesPanel'
import { TableDetailPanel } from '../table-detail/TableDetailPanel'
import { TableListPane } from '../table-list/TableListPane'
import { DiagramCanvas } from './DiagramCanvas'
import { useTableGroups } from './groups/api'
import { forgetVisit } from './groups/GroupLayoutOffer'
import { GroupSelect } from './groups/GroupSelect'
import { GroupEditingProvider } from './groups/group-editing'
import { buildGroupView } from './groups/group-view'
import { hiddenHubRelationships, hubViewSchema, resolveHubs } from './hubs'
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
  /** Comparison: the compared (after) side, which proposes the groups when none is saved. */
  proposalSchema?: DbSchema
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
  proposalSchema,
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
  // Loading or failed: no groups, the diagram shows as usual (its first placement waits for them).
  const groupsQuery = useTableGroups(repo, sourceId)
  // Proposals shown again over the saved groups: local, and only for the source it was asked on.
  const [reproposedFor, setReproposedFor] = useState<string>()
  const reproposed = reproposedFor === sourceId
  const groups = useMemo(
    () =>
      buildGroupView(schema, groupsQuery.data, {
        proposalSchema,
        loading: groupsQuery.isPending,
        reproposed,
      }),
    [schema, groupsQuery.data, proposalSchema, groupsQuery.isPending, reproposed],
  )
  // Leaving this source's diagram ends its visit, for the offer to lay it out by group. The
  // workspace stays mounted while the canvas mounts again (mode, related view).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the repository's identity is its name
  useEffect(() => () => forgetVisit(repo, sourceId), [repo.owner, repo.name, sourceId])
  // Back to the saved groups when the source changes (also on a later return to this source).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on the source change only
  useEffect(() => setReproposedFor(undefined), [sourceId])
  const hasProposals = useMemo(
    () => proposeGroups(proposalSchema ?? schema).length > 0,
    [proposalSchema, schema],
  )
  const canRepropose =
    groupsQuery.data?.configured === true && groups.canEdit && !reproposed && hasProposals
  const changedOnly = viewState.changed === true
  // Leaving the related view remounts the full canvas: it centres the table once placed.
  const [centerAfterRemount, setCenterAfterRemount] = useState<string>()
  const canvasHidden = useMemo(
    () => canvasHiddenTables(tables.hidden, diff, changedOnly),
    [tables.hidden, diff, changedOnly],
  )
  const hubsKey = viewState.hubs === undefined ? undefined : viewState.hubs.join('\n')
  const hubsSchema = useMemo(
    () =>
      diff
        ? hubViewSchema(
            schema,
            (name) => diff.tables[name]?.status === 'removed',
            (relationship) => relationshipStatus(diff, relationship) === 'removed',
          )
        : schema,
    [schema, diff],
  )
  const hubs = useMemo(
    () =>
      resolveHubs(
        hubsSchema,
        hubsKey === undefined ? undefined : hubsKey ? hubsKey.split('\n') : [],
      ),
    [hubsSchema, hubsKey],
  )
  const hiddenHubEdges = useMemo(
    () =>
      hiddenHubRelationships(hubsSchema, hubs, viewState.hubLinks ?? 'all', (relationship) =>
        diff ? relationshipStatus(diff, relationship) !== 'unchanged' : false,
      ),
    [hubsSchema, hubs, viewState.hubLinks, diff],
  )
  const changeHubLinks = (hubLinks: 'none' | 'first' | undefined) =>
    updateView({ hubLinks }, { replace: true })
  const toggleHub = (table: string, on: boolean) => {
    const next = on
      ? hubs.includes(table)
        ? hubs
        : [...hubs, table]
      : hubs.filter((name) => name !== table)
    updateView({ hubs: next }, { replace: true })
  }

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
  // A group's checkbox: one URL update for all its tables.
  const setTablesHidden = (list: string[], hide: boolean) => {
    if (hide) return setHidden(new Set([...tables.hidden, ...list]))
    const leaveChangedOnly = list.some(hiddenAsUnchanged)
    updateView(
      {
        ...hiddenPatch(names, new Set([...tables.hidden].filter((name) => !list.includes(name)))),
        ...(leaveChangedOnly ? { changed: undefined } : {}),
      },
      { replace: true },
    )
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
    <GroupEditingProvider
      repo={repo}
      sourceId={sourceId}
      schema={schema}
      view={groups}
      saved={groupsQuery.data}
    >
      <div className="absolute inset-0 flex">
        <TableListPane
          schema={schema}
          hidden={canvasHidden}
          active={tables.active}
          onToggle={toggle}
          onShowAll={showAll}
          onHideAll={() => setHidden(new Set(names))}
          onSelect={select}
          groups={groups}
          onSetHidden={setTablesHidden}
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
              hiddenHubEdges={hiddenHubEdges}
              hubs={hubs}
              hubLinks={viewState.hubLinks}
              onHubLinksChange={changeHubLinks}
              groups={groups}
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
              hiddenHubEdges={hiddenHubEdges}
              hubs={hubs}
              hubLinks={viewState.hubLinks}
              onHubLinksChange={changeHubLinks}
              groups={groups}
              onRepropose={canRepropose ? () => setReproposedFor(sourceId) : undefined}
              onLeaveReproposal={() => setReproposedFor(undefined)}
            />
          )}
        </div>
        {tables.active && (
          <TableDetailPanel
            schema={schema}
            tableName={tables.active}
            onClose={() => activate(undefined)}
            diff={diff?.tables[tables.active]}
            isHub={hubs.includes(tables.active)}
            onHubChange={(on) => toggleHub(tables.active as string, on)}
            group={<GroupSelect key={tables.active} table={tables.active} />}
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
    </GroupEditingProvider>
  )
}
