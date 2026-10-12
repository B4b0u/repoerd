export const diagram = {
  treeTruncated:
    'This repository is too large for the GitHub API: the file list is incomplete, so some schemas may be missing from detection.',
  failure: {
    noSchemaFound:
      'No Prisma or Drizzle schema was found on this branch. RepoERD looks for schema.prisma files, prisma/schema/ folders, prisma.config files, the "prisma.schema" field of package.json files and drizzle.config files.',
    sourceNotFound: 'The schema source "{{sourceId}}" does not exist on this branch.',
    sourceEmpty: 'The schema configuration matches no file on this branch.',
    drizzleConfigUnreadable:
      'The "schema" option of {{configPath}} is computed at runtime, so it cannot be read without executing the file. Use a literal path, array or glob in the config.',
    unsafePattern:
      'The pattern "{{pattern}}" is too complex or uses an unsupported syntax: braces, extended globs and negations are not supported, and patterns are limited to 200 characters, 8 "*", and 2 "*" groups per folder level. Simplify it in the repository settings or in drizzle.config.',
    tooManyFiles: 'This schema spans {{actual}} files; the limit is {{max}}.',
    tooLarge: 'This schema weighs {{actual}}; the limit is {{max}}.',
    tooManyConfigs:
      'This branch has {{actual}} schema configuration files; RepoERD reads the first {{max}}. Declare the schema sources by hand to choose.',
    fileTooComplex:
      'RepoERD does not analyse {{path}}: files over 256 KB, or nested over 500 levels deep, are refused to protect the server.',
    unsupportedDialect:
      'The dialect of {{configPath}} is "{{dialect}}": RepoERD reads PostgreSQL schemas only.',
    prismaConfigUnreadable:
      'The "schema" option of {{configPath}} is computed at runtime, so it cannot be read without executing the file. Use a literal path in the config, or declare the schema sources by hand.',
    noTablesFound: 'The files of this schema declare no table that RepoERD can read.',
    unresolvedImports:
      'These imports could not be followed: {{imports}}. Declare the files they point to in the schema sources.',
    parseError: 'The schema could not be parsed:\n{{message}}',
    prismaRejected:
      'Prisma refused this schema. RepoERD reads Prisma schemas with Prisma 6.8: a schema written for a newer version may use something it does not know yet. Prisma says:\n{{message}}',
    parserCrashed:
      'The parser stopped unexpectedly while reading this schema: it may be too large or too deeply nested.',
    parseTimeout: 'Parsing the schema took longer than 10 seconds and was stopped.',
    declareSources: 'Declare the schema sources by hand',
    showDefaultSource: 'Show the default schema',
  },
  toolbar: {
    sources: 'Sources',
    sourcesTitle: 'Schema sources of this repository',
    refresh: 'Refresh from the repository',
  },
  branch: {
    loading: 'Loading…',
    sourceMissing: 'Source "{{source}}" does not exist on this branch: showing the default source.',
    current: 'Branch: {{branch}}',
    search: 'Search branches…',
    none: 'No branch found.',
    loadFailed: 'Could not load the branches: {{message}}',
    refine_one: '{{count}} more branch matches: refine the search.',
    refine_other: '{{count}} more branches match: refine the search.',
    truncated: 'GitHub lists more branches than RepoERD reads: some are missing.',
  },
  source: { label: 'Schema' },
  commit: { open: 'Open commit {{sha}} on GitHub' },
  loading: 'Loading schema…',
  emptySchema: 'This schema has no tables.',
  ignoredViews_one: '{{count}} view is not shown: RepoERD draws tables only.',
  ignoredViews_other: '{{count}} views are not shown: RepoERD draws tables only.',
  loadFailed: 'Could not load the schema: {{message}}',
  placementFailed: 'Could not place the tables: {{message}}',
  layoutLoadFailed: 'Could not load your layout: {{message}}',
  a11y: {
    node: 'A table of the diagram. The table list reaches every table with the keyboard.',
    moved: 'Table moved {{direction}}: x {{x}}, y {{y}}.',
    edge: 'A relationship between two tables.',
    controls: 'Diagram controls',
    interactive: 'Toggle interactivity',
    minimap: 'Mini map',
    handle: 'Link point',
  },
  canvas: {
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit to screen',
    rearrange: 'Rearrange all tables',
    displayMode: 'Display mode',
    placing: 'Placing tables…',
  },
  displayModes: {
    ALL_FIELDS: 'All fields',
    KEYS_ONLY: 'Keys only',
    TABLE_NAME: 'Table name',
  },
  rearrange: {
    title: 'Rearrange all tables?',
    description: 'Your saved layout for this view will be replaced.',
    confirm: 'Rearrange',
  },
  layout: { saveFailed: 'Layout changes could not be saved.' },
  related: {
    banner: 'Tables related to <strong>{{table}}</strong>',
    back: 'Back to full schema',
  },
  preview: {
    related_one: '{{count}} related table',
    related_other: '{{count}} related tables',
    selfOnly: 'Related to itself only',
    none: 'No related table',
    open: 'Open in main view',
  },
}
