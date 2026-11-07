import type { TableGroupsProblem } from '@repoerd/model'

/**
 * Texts of the table groups. Not in the initial catalogues (first-page weight): the diagram's
 * chunk registers them (features/diagram/groups/groups-i18n.ts).
 */
export const groups = {
  proposed_one: '{{count}} group proposed from the schema files',
  proposed_other: '{{count}} groups proposed from the schema files',
  saveForTeam: 'Save for the team',
  ignoreForTeam: 'Ignore for the team',
  replaceForTeam: 'Replace for the team',
  cancelProposal: 'Cancel',
  repropose: 'Propose again from the files',
  reproposeHint: 'Show the groups proposed from the schema files instead of the saved ones',
  replaced: 'Groups replaced by the proposals.',
  tag: 'Group: {{name}}',
  ungrouped: 'Ungrouped',
  showGroup: 'Show the group {{name}}',
  collapseGroup: 'Collapse the group {{name}}',
  expandGroup: 'Expand the group {{name}}',
  undo: 'Undo',
  /** The editor a frame label opens (push right). */
  editor: {
    open: 'Edit the group {{name}}',
    name: 'Name',
    rename: 'Rename',
    color: 'Color',
    swatch: 'Color {{n}}',
    custom: 'Custom color',
    delete: 'Delete the group',
    deleteHint: 'Its tables become ungrouped.',
  },
  /** The group of a table in its details. */
  detail: {
    label: 'Group',
    followFile: 'Follow its file',
    newGroup: 'New group…',
    newName: 'Name of the new group',
    create: 'Create',
    cancel: 'Cancel',
  },
  /** The bar of the tables selected on the canvas (Shift+click, Shift+drag). */
  selection: {
    toolbar: 'Selected tables',
    count_one: '{{count}} table selected',
    count_other: '{{count}} tables selected',
    placeInto: 'Place into…',
    clear: 'Clear the selection',
  },
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
