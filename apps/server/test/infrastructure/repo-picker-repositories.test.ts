import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type AppDatabase, openDatabase } from '../../src/infrastructure/persistence/database.js'
import { users } from '../../src/infrastructure/persistence/schema.js'
import { SqliteFavoriteRepository } from '../../src/infrastructure/persistence/sqlite-favorite-repository.js'
import { SqliteRepoFormatRepository } from '../../src/infrastructure/persistence/sqlite-repo-format-repository.js'
import { SqliteVisitRepository } from '../../src/infrastructure/persistence/sqlite-visit-repository.js'

const repoOf = (id: number) => ({ id, owner: 'acme', name: `r${id}` })
const t = (n: number) => new Date(1_700_000_000_000 + n * 1000)

let db: AppDatabase
let close: () => void

beforeEach(() => {
  ;({ db, close } = openDatabase(':memory:'))
  db.insert(users)
    .values({ id: 'alice', login: 'alice', createdAt: t(0) })
    .run()
})
afterEach(() => close())

describe('SqliteFavoriteRepository', () => {
  it('adds, lists and removes favourites', async () => {
    const favorites = new SqliteFavoriteRepository(db)
    expect(await favorites.add('alice', repoOf(1), t(1))).toBe('added')
    expect(await favorites.add('alice', repoOf(2), t(2))).toBe('added')
    expect(await favorites.list('alice')).toEqual(new Set(['1', '2']))
    await favorites.remove('alice', repoOf(1))
    expect(await favorites.list('alice')).toEqual(new Set(['2']))
  })

  it('refuses the 101st favourite but accepts an existing one at the limit', async () => {
    const favorites = new SqliteFavoriteRepository(db)
    for (let i = 1; i <= 100; i++) await favorites.add('alice', repoOf(i), t(i))
    expect(await favorites.add('alice', repoOf(101), t(101))).toBe('limit')
    expect((await favorites.list('alice')).has('101')).toBe(false)
    expect(await favorites.add('alice', repoOf(5), t(102))).toBe('added')
    expect((await favorites.list('alice')).size).toBe(100)
  })

  it('deletes favourites and visits with the user', async () => {
    const favorites = new SqliteFavoriteRepository(db)
    const visits = new SqliteVisitRepository(db)
    await favorites.add('alice', repoOf(1), t(1))
    await visits.record('alice', repoOf(1), t(1))
    db.delete(users).where(eq(users.id, 'alice')).run()
    expect((await favorites.list('alice')).size).toBe(0)
    expect((await visits.list('alice')).size).toBe(0)
  })
})

describe('SqliteVisitRepository', () => {
  it('keeps the 20 most recent visits', async () => {
    const visits = new SqliteVisitRepository(db)
    for (let i = 1; i <= 21; i++) await visits.record('alice', repoOf(i), t(i))
    const listed = await visits.list('alice')
    expect(listed.size).toBe(20)
    expect(listed.has('1')).toBe(false)
    expect(listed.get('21')).toEqual(t(21))
  })

  it('updates the date of a repeated visit', async () => {
    const visits = new SqliteVisitRepository(db)
    await visits.record('alice', repoOf(1), t(1))
    await visits.record('alice', repoOf(1), t(5))
    expect((await visits.list('alice')).get('1')).toEqual(t(5))
  })
})

describe('SqliteRepoFormatRepository', () => {
  it('round-trips a saved format', async () => {
    const formats = new SqliteRepoFormatRepository(db)
    await formats.save(repoOf(1), { format: 'prisma', commitSha: 'abc', checkedAt: t(1) })
    expect(await formats.getMany(['1', '2'])).toEqual(
      new Map([
        [
          '1',
          { format: 'prisma', commitSha: 'abc', checkedAt: t(1), failedAt: null, stale: false },
        ],
      ]),
    )
  })

  it('marks stale, and save clears stale and failure', async () => {
    const formats = new SqliteRepoFormatRepository(db)
    await formats.save(repoOf(1), { format: 'drizzle', commitSha: 'abc', checkedAt: t(1) })
    await formats.markStale(repoOf(1))
    await formats.markFailed(repoOf(1), t(2))
    const stale = (await formats.getMany(['1'])).get('1')
    expect(stale).toMatchObject({ stale: true, failedAt: t(2), format: 'drizzle' })
    await formats.save(repoOf(1), { format: 'both', commitSha: 'def', checkedAt: t(3) })
    expect((await formats.getMany(['1'])).get('1')).toEqual({
      format: 'both',
      commitSha: 'def',
      checkedAt: t(3),
      failedAt: null,
      stale: false,
    })
  })

  it('touch updates the check date only', async () => {
    const formats = new SqliteRepoFormatRepository(db)
    await formats.save(repoOf(1), { format: 'none', commitSha: 'abc', checkedAt: t(1) })
    await formats.touch(repoOf(1), t(9))
    expect((await formats.getMany(['1'])).get('1')).toMatchObject({
      commitSha: 'abc',
      checkedAt: t(9),
    })
  })

  it('stores a failure for a never-detected repository', async () => {
    const formats = new SqliteRepoFormatRepository(db)
    await formats.markFailed(repoOf(3), t(4))
    expect((await formats.getMany(['3'])).size).toBe(0)
    expect(await formats.getFailures(['3', '4'])).toEqual(new Map([['3', t(4)]]))
  })
})
