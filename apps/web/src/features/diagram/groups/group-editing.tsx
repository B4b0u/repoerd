import type { TableGroupsResponse } from '@repoerd/contracts'
import type { DbSchema, RepoRef } from '@repoerd/model'
import { createContext, type ReactNode, useContext } from 'react'
import type { GroupView } from './group-view'
import { useGroupEdits } from './use-group-edits'

export interface GroupEditing {
  schema: DbSchema
  view: GroupView
  /** The groups as saved; undefined while they load or when they failed to. */
  saved: TableGroupsResponse | undefined
  /** The editing commands are offered: push right, and not a local preview of proposals. */
  editable: boolean
  edits: ReturnType<typeof useGroupEdits>
}

const GroupEditingContext = createContext<GroupEditing | undefined>(undefined)

interface Props {
  repo: RepoRef
  sourceId: string
  schema: DbSchema
  view: GroupView
  saved: TableGroupsResponse | undefined
  children: ReactNode
}

/** The groups of the diagram workspace and their editing commands, for the frames and details. */
export function GroupEditingProvider({ repo, sourceId, schema, view, saved, children }: Props) {
  const edits = useGroupEdits(repo, sourceId, schema, view)
  // Proposals shown again are not the saved groups: editing them would write to unknown groups.
  const editable = view.canEdit && !view.reproposed
  return (
    <GroupEditingContext value={{ schema, view, saved, editable, edits }}>
      {children}
    </GroupEditingContext>
  )
}

/** Undefined outside the diagram workspace (no groups to edit there). */
export const useGroupEditing = () => useContext(GroupEditingContext)

/** The table is placed by hand (in a group or out of any), not by its origin. */
export function isPlacedByHand(editing: GroupEditing, table: string): boolean {
  const { saved, view } = editing
  return saved?.configured === true && !view.reproposed && Object.hasOwn(saved.assignments, table)
}
