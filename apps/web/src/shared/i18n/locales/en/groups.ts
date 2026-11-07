import type { TableGroupsProblem } from '@repoerd/model'

/**
 * Texts of the table groups. Not in the initial catalogues (first-page weight): the diagram's
 * chunk registers them (features/diagram/groups/groups-i18n.ts).
 */
export const groups = {
  proposed_one: '{{count}} group proposed from the schema files',
  proposed_other: '{{count}} groups proposed from the schema files',
  tag: 'Group: {{name}}',
  ungrouped: 'Ungrouped',
  showGroup: 'Show the group {{name}}',
  collapseGroup: 'Collapse the group {{name}}',
  expandGroup: 'Expand the group {{name}}',
  undo: 'Undo',
  notices: {
    deleted: 'Group "{{name}}" deleted.',
    placed_one: '{{count}} table placed in "{{name}}".',
    placed_other: '{{count}} tables placed in "{{name}}".',
    ungrouped_one: '{{count}} table taken out of its group.',
    ungrouped_other: '{{count}} tables taken out of their group.',
    followFile_one: '{{count}} table follows its file again.',
    followFile_other: '{{count}} tables follow their file again.',
  },
  /** A refused group write, by `details.problem` ('invalid' keeps the message of the reason). */
  problems: {
    'unknown-group': 'This group no longer exists: someone may have deleted it meanwhile.',
    'too-many-groups': 'At most {{max}} groups per schema source.',
    'too-many-assignments': 'At most {{max}} tables placed by hand per schema source.',
    'too-many-sources':
      'This repository already has groups for {{max}} schema sources, the maximum.',
    'duplicate-origin':
      'Two groups claim the same file, folder or Postgres schema. Reload the page and try again.',
  } satisfies Record<Exclude<TableGroupsProblem, 'invalid'>, string>,
}

export type GroupsCatalog = typeof groups
