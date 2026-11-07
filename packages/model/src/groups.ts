import type { DbSchema } from './schema.js'

export type GroupOrigin =
  | { kind: 'file'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'pgSchema'; name: string }

export interface TableGroup {
  id: string
  name: string
  color: string
  origins: GroupOrigin[]
}

export interface TableGroupConfig {
  groups: TableGroup[]
  /** Manual placements: table name → group id, or null for "explicitly ungrouped". */
  assignments: Record<string, string | null>
}

export const TABLE_GROUP_LIMITS = {
  groups: 100,
  name: 80,
  origins: 1000,
  originText: 512,
  tableName: 256,
  assignments: 5000,
  /** Distinct configured schema sources per repository. */
  sources: 50,
} as const

/** Attribution order of the group colours: 12 distinct, saturated, mid-lightness hues. */
export const GROUP_PALETTE: readonly string[] = [
  '#e6194b',
  '#f58231',
  '#d4a017',
  '#9acd32',
  '#3cb44b',
  '#17b8a6',
  '#1e90ff',
  '#4363d8',
  '#8a4fe0',
  '#c13fd1',
  '#e8509b',
  '#8d6e63',
]

/** FNV-1a 32 bits over the UTF-8 bytes of the text, as 8 lower-case hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Stable id of an automatic proposal: `p` + FNV-1a of `${kind}:${path|name}`. */
export function proposalId(origin: GroupOrigin): string {
  const key = origin.kind === 'pgSchema' ? origin.name : origin.path
  return `p${fnv1a(`${origin.kind}:${key}`)}`
}

const dirOf = (file: string): string => file.slice(0, Math.max(file.lastIndexOf('/'), 0))

/** Longest common directory prefix ('' when none), compared segment by segment. */
function commonDirectory(files: string[]): string {
  let common = dirOf(files[0] ?? '').split('/')
  for (const file of files) {
    const parts = dirOf(file).split('/')
    let n = 0
    while (n < common.length && n < parts.length && common[n] === parts[n]) n++
    common = common.slice(0, n)
  }
  return common.filter(Boolean).join('/')
}

interface Proposal {
  name: string
  origin: GroupOrigin
}

function fileProposals(files: string[]): Proposal[] {
  return files.map((path) => ({
    name: (path.split('/').pop() ?? path).split('.')[0] ?? path,
    origin: { kind: 'file', path },
  }))
}

function folderProposals(files: string[]): Proposal[] | null {
  const root = commonDirectory(files)
  const prefix = root === '' ? '' : `${root}/`
  const subfolders = new Set<string>()
  for (const file of files) {
    const rest = file.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash <= 0) return null
    subfolders.add(rest.slice(0, slash))
  }
  if (subfolders.size < 2) return null
  return [...subfolders].map((name) => ({
    name,
    origin: { kind: 'folder', path: `${prefix}${name}` },
  }))
}

/**
 * Automatic group proposals: one group per domain folder, else per schema file, else per
 * Postgres schema; empty when the tables show no such split. Only tables with a `file` count.
 */
export function proposeGroups(schema: DbSchema): TableGroup[] {
  const tables = Object.values(schema.tables).filter((t) => t.file !== undefined)
  const files = [...new Set(tables.map((t) => t.file as string))]
  let found: Proposal[] = []
  if (files.length >= 2) {
    found = folderProposals(files) ?? fileProposals(files)
  } else {
    const pgSchemas = [...new Set(tables.map((t) => t.schema ?? 'public'))]
    if (pgSchemas.length >= 2) {
      found = pgSchemas.map((name) => ({ name, origin: { kind: 'pgSchema', name } }))
    }
  }
  return found
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, TABLE_GROUP_LIMITS.groups)
    .map(({ name, origin }, i) => ({
      id: proposalId(origin),
      name,
      color: GROUP_PALETTE[i % GROUP_PALETTE.length] as string,
      origins: [origin],
    }))
}

const assignmentOf = (config: TableGroupConfig, table: string): string | null | undefined =>
  Object.hasOwn(config.assignments, table) ? config.assignments[table] : undefined

/**
 * Group of every table of the schema: manual placement, else the most precise matching
 * origin (file > folder > pgSchema), else null. A placement to an unknown group is ignored.
 */
export function resolveTableGroups(
  schema: DbSchema,
  config: TableGroupConfig,
): Map<string, string | null> {
  const known = new Set(config.groups.map((g) => g.id))
  const fileOwner = new Map<string, string>()
  const folderOwner = new Map<string, string>()
  const pgSchemaOwner = new Map<string, string>()
  for (const g of config.groups) {
    for (const o of g.origins) {
      const owners =
        o.kind === 'file' ? fileOwner : o.kind === 'folder' ? folderOwner : pgSchemaOwner
      const key = o.kind === 'pgSchema' ? o.name : o.path
      if (!owners.has(key)) owners.set(key, g.id)
    }
  }
  const folders = [...folderOwner.keys()].sort((a, b) => b.length - a.length)

  const resolved = new Map<string, string | null>()
  for (const table of Object.values(schema.tables)) {
    const manual = assignmentOf(config, table.name)
    if (manual === null || (manual !== undefined && known.has(manual))) {
      resolved.set(table.name, manual)
      continue
    }
    const file = table.file
    let id: string | undefined
    if (file !== undefined) {
      id = fileOwner.get(file)
      if (id === undefined) {
        const folder = folders.find((f) => file.startsWith(`${f}/`))
        if (folder !== undefined) id = folderOwner.get(folder)
      }
    }
    id ??= pgSchemaOwner.get(table.schema ?? 'public')
    resolved.set(table.name, id ?? null)
  }
  return resolved
}

/**
 * Adds to group G every file all of whose tables (in this schema) are placed by hand in G,
 * and removes that file origin from any other group.
 */
export function adoptOrigins(schema: DbSchema, config: TableGroupConfig): TableGroupConfig {
  const known = new Set(config.groups.map((g) => g.id))
  const byFile = new Map<string, string[]>()
  for (const table of Object.values(schema.tables)) {
    if (table.file === undefined) continue
    byFile.set(table.file, [...(byFile.get(table.file) ?? []), table.name])
  }
  const adopted = new Map<string, string>()
  for (const [file, names] of byFile) {
    const owner = assignmentOf(config, names[0] as string)
    if (typeof owner !== 'string' || !known.has(owner)) continue
    if (names.every((n) => assignmentOf(config, n) === owner)) adopted.set(file, owner)
  }
  const groups = config.groups.map((g) => {
    const origins = g.origins.filter(
      (o) => o.kind !== 'file' || adopted.get(o.path) === undefined || adopted.get(o.path) === g.id,
    )
    for (const [path, owner] of adopted) {
      if (owner === g.id && !origins.some((o) => o.kind === 'file' && o.path === path)) {
        origins.push({ kind: 'file', path })
      }
    }
    return { ...g, origins }
  })
  return { groups, assignments: config.assignments }
}

/** The config without the group: its manual placements are dropped. */
export function withoutGroup(config: TableGroupConfig, groupId: string): TableGroupConfig {
  return {
    groups: config.groups.filter((g) => g.id !== groupId),
    assignments: Object.fromEntries(
      Object.entries(config.assignments).filter(([, id]) => id !== groupId),
    ),
  }
}

/** Identity of an origin: its kind plus its path (file, folder) or name (pgSchema). */
export const originKey = (origin: GroupOrigin): string =>
  `${origin.kind}:${origin.kind === 'pgSchema' ? origin.name : origin.path}`

/** Why the server refused a group write (`details.problem` of an `invalid-groups*` error). */
export type TableGroupsProblem =
  | 'unknown-group'
  | 'too-many-groups'
  | 'too-many-assignments'
  | 'too-many-sources'
  | 'duplicate-origin'
  | 'invalid'
