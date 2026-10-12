export const settings = {
  back: 'Back to the diagram',
  title: 'Schema sources of {{repo}}',
  intro:
    'RepoERD finds Prisma and Drizzle schemas by itself. Declare sources here when it finds none or the wrong files: they then replace automatic detection for this repository. Paths are relative to the repository root and may be files, folders or globs such as <code>packages/db/src/**/*.ts</code>; the relative imports of Drizzle files are followed.',
  readOnly: 'You need push access to the repository to change these settings.',
  automatic: 'No source declared: automatic detection is on.',
  source: 'Source {{number}}',
  name: 'Name',
  format: 'Format',
  paths: 'Paths (one per line)',
  remove: 'Remove',
  removeSource: 'Remove source {{number}}',
  add: 'Add a source',
  save: 'Save',
  saved: 'Saved. These sources replace automatic detection.',
  savedAutomatic: 'Saved. Automatic detection is back on.',
  unsaved: {
    title: 'Leave without saving?',
    description: 'Your changes to the sources are not saved yet: they will be lost.',
    stay: 'Stay',
    leave: 'Leave',
  },
}
