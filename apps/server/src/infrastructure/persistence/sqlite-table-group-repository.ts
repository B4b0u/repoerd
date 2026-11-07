import { TABLE_GROUP_LIMITS, type TableGroup, type TableGroupConfig } from '@repoerd/model'
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import type {
  StoredTableGroups,
  TableGroupRepository,
} from '../../application/ports/table-groups.js'
import type { KnownRepo } from '../../domain/repo.js'
import type { AppDatabase } from './database.js'
import { chunk, repoKey } from './keys.js'
import { tableGroupAssignments, tableGroupConfigs, tableGroups } from './schema.js'

type Tx = Parameters<Parameters<AppDatabase['transaction']>[0]>[0]

export class SqliteTableGroupRepository implements TableGroupRepository {
  constructor(private readonly db: AppDatabase) {}

  async get(repo: KnownRepo, sourceId: string): Promise<StoredTableGroups> {
    const key = repoKey(repo)
    const configured =
      this.db
        .select({ repo: tableGroupConfigs.repo })
        .from(tableGroupConfigs)
        .where(and(eq(tableGroupConfigs.repo, key), eq(tableGroupConfigs.sourceId, sourceId)))
        .get() !== undefined
    const groups = this.db
      .select()
      .from(tableGroups)
      .where(and(eq(tableGroups.repo, key), eq(tableGroups.sourceId, sourceId)))
      .orderBy(asc(tableGroups.position))
      .all()
      .map((row) => ({ id: row.groupId, name: row.name, color: row.color, origins: row.origins }))
    const assignments: Record<string, string | null> = {}
    const placed = this.db
      .select({ table: tableGroupAssignments.tableName, groupId: tableGroupAssignments.groupId })
      .from(tableGroupAssignments)
      .where(and(eq(tableGroupAssignments.repo, key), eq(tableGroupAssignments.sourceId, sourceId)))
      .all()
    for (const row of placed) assignments[row.table] = row.groupId
    return { configured, config: { groups, assignments } }
  }

  async replace(repo: KnownRepo, sourceId: string, config: TableGroupConfig, userId: string) {
    const key = repoKey(repo)
    this.db.transaction((tx) => {
      tx.delete(tableGroups)
        .where(and(eq(tableGroups.repo, key), eq(tableGroups.sourceId, sourceId)))
        .run()
      tx.delete(tableGroupAssignments)
        .where(
          and(eq(tableGroupAssignments.repo, key), eq(tableGroupAssignments.sourceId, sourceId)),
        )
        .run()
      const updatedAt = new Date()
      const groupRows = config.groups.map((group, position) => ({
        repo: key,
        sourceId,
        groupId: group.id,
        position,
        name: group.name,
        color: group.color,
        origins: group.origins,
        updatedAt,
        updatedBy: userId,
      }))
      for (const rows of chunk(groupRows)) tx.insert(tableGroups).values(rows).run()
      const placementRows = Object.entries(config.assignments).map(([tableName, groupId]) => ({
        repo: key,
        sourceId,
        tableName,
        groupId,
      }))
      for (const rows of chunk(placementRows)) tx.insert(tableGroupAssignments).values(rows).run()
      this.markConfigured(tx, key, sourceId, userId)
    })
  }

  async saveGroup(
    repo: KnownRepo,
    sourceId: string,
    group: TableGroup,
    userId: string,
  ): Promise<{ ok: true } | { ok: false; error: 'too-many-groups' }> {
    const key = repoKey(repo)
    return this.db.transaction((tx) => {
      const inSource = and(eq(tableGroups.repo, key), eq(tableGroups.sourceId, sourceId))
      const exists =
        tx
          .select({ id: tableGroups.groupId })
          .from(tableGroups)
          .where(and(inSource, eq(tableGroups.groupId, group.id)))
          .get() !== undefined
      if (!exists) {
        const total = tx.select({ n: count() }).from(tableGroups).where(inSource).get()?.n ?? 0
        if (total >= TABLE_GROUP_LIMITS.groups)
          return { ok: false, error: 'too-many-groups' } as const
      }
      const last = tx
        .select({ max: sql<number | null>`max(${tableGroups.position})` })
        .from(tableGroups)
        .where(and(eq(tableGroups.repo, key), eq(tableGroups.sourceId, sourceId)))
        .get()
      const fields = {
        name: group.name,
        color: group.color,
        origins: group.origins,
        updatedAt: new Date(),
        updatedBy: userId,
      }
      // `position` is left out of the update set: an existing group keeps its place.
      tx.insert(tableGroups)
        .values({
          repo: key,
          sourceId,
          groupId: group.id,
          position: (last?.max ?? -1) + 1,
          ...fields,
        })
        .onConflictDoUpdate({
          target: [tableGroups.repo, tableGroups.sourceId, tableGroups.groupId],
          set: fields,
        })
        .run()
      this.markConfigured(tx, key, sourceId, userId)
      return { ok: true } as const
    })
  }

  async deleteGroup(repo: KnownRepo, sourceId: string, groupId: string, userId: string) {
    const key = repoKey(repo)
    this.db.transaction((tx) => {
      const deleted = tx
        .delete(tableGroups)
        .where(
          and(
            eq(tableGroups.repo, key),
            eq(tableGroups.sourceId, sourceId),
            eq(tableGroups.groupId, groupId),
          ),
        )
        .run()
      if (deleted.changes === 0) return
      tx.delete(tableGroupAssignments)
        .where(
          and(
            eq(tableGroupAssignments.repo, key),
            eq(tableGroupAssignments.sourceId, sourceId),
            eq(tableGroupAssignments.groupId, groupId),
          ),
        )
        .run()
      this.markConfigured(tx, key, sourceId, userId)
    })
  }

  async place(
    repo: KnownRepo,
    sourceId: string,
    assignments: Record<string, string | null>,
    userId: string,
  ): Promise<{ ok: true } | { ok: false; error: 'unknown-group' | 'too-many-assignments' }> {
    if (Object.keys(assignments).length === 0) return { ok: true }
    const key = repoKey(repo)
    const wanted = [...new Set(Object.values(assignments).filter((id) => id !== null))]
    return this.db.transaction((tx) => {
      const known = new Set<string>()
      for (const ids of chunk(wanted)) {
        const rows = tx
          .select({ id: tableGroups.groupId })
          .from(tableGroups)
          .where(
            and(
              eq(tableGroups.repo, key),
              eq(tableGroups.sourceId, sourceId),
              inArray(tableGroups.groupId, ids),
            ),
          )
          .all()
        for (const row of rows) known.add(row.id)
      }
      if (wanted.some((id) => !known.has(id))) return { ok: false, error: 'unknown-group' } as const
      const inSource = and(
        eq(tableGroupAssignments.repo, key),
        eq(tableGroupAssignments.sourceId, sourceId),
      )
      const stored =
        tx.select({ n: count() }).from(tableGroupAssignments).where(inSource).get()?.n ?? 0
      let alreadyPlaced = 0
      for (const names of chunk(Object.keys(assignments))) {
        alreadyPlaced +=
          tx
            .select({ n: count() })
            .from(tableGroupAssignments)
            .where(and(inSource, inArray(tableGroupAssignments.tableName, names)))
            .get()?.n ?? 0
      }
      if (stored + Object.keys(assignments).length - alreadyPlaced > TABLE_GROUP_LIMITS.assignments)
        return { ok: false, error: 'too-many-assignments' } as const
      const rows = Object.entries(assignments).map(([tableName, groupId]) => ({
        repo: key,
        sourceId,
        tableName,
        groupId,
      }))
      for (const part of chunk(rows)) {
        tx.insert(tableGroupAssignments)
          .values(part)
          .onConflictDoUpdate({
            target: [
              tableGroupAssignments.repo,
              tableGroupAssignments.sourceId,
              tableGroupAssignments.tableName,
            ],
            set: { groupId: sql`excluded.group_id` },
          })
          .run()
      }
      this.markConfigured(tx, key, sourceId, userId)
      return { ok: true } as const
    })
  }

  private markConfigured(tx: Tx, key: string, sourceId: string, userId: string) {
    const values = { repo: key, sourceId, updatedAt: new Date(), updatedBy: userId }
    tx.insert(tableGroupConfigs)
      .values(values)
      .onConflictDoUpdate({
        target: [tableGroupConfigs.repo, tableGroupConfigs.sourceId],
        set: { updatedAt: values.updatedAt, updatedBy: userId },
      })
      .run()
  }
}
