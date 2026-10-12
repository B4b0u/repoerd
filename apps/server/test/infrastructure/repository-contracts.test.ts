import { createSecretBox } from '../../src/infrastructure/crypto/secret-box.js'
import { type AppDatabase, openDatabase } from '../../src/infrastructure/persistence/database.js'
import { SqliteLayoutRepository } from '../../src/infrastructure/persistence/sqlite-layout-repository.js'
import { SqliteSessionRepository } from '../../src/infrastructure/persistence/sqlite-session-repository.js'
import { SqliteUserRepository } from '../../src/infrastructure/persistence/sqlite-user-repository.js'
import {
  type Factory,
  layoutRepositoryContract,
  sessionRepositoryContract,
  userRepositoryContract,
} from '../contracts/repository-contracts.js'
import {
  InMemoryLayoutRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from '../fakes/in-memory-stores.js'

const box = createSecretBox('k'.repeat(32))

/** SQLite in memory with alice and bob signed in once (sessions and layouts reference users). */
function sqlite<T>(make: (db: AppDatabase) => T): Factory<T> {
  return async () => {
    const { db, close } = openDatabase(':memory:')
    const users = new SqliteUserRepository(db, box)
    await users.upsert({ id: 'alice', login: 'alice', avatarUrl: null })
    await users.upsert({ id: 'bob', login: 'bob', avatarUrl: null })
    return { repo: make(db), close }
  }
}

const inMemory =
  <T>(make: () => T): Factory<T> =>
  async () => ({ repo: make(), close: () => {} })

userRepositoryContract(
  'SqliteUserRepository',
  sqlite((db) => new SqliteUserRepository(db, box)),
)
userRepositoryContract('InMemoryUserRepository (test fake)', async () => {
  const users = new InMemoryUserRepository()
  await users.upsert({ id: 'alice', login: 'alice', avatarUrl: null })
  await users.upsert({ id: 'bob', login: 'bob', avatarUrl: null })
  return { repo: users, close: () => {} }
})
sessionRepositoryContract(
  'SqliteSessionRepository',
  sqlite((db) => new SqliteSessionRepository(db)),
)
sessionRepositoryContract(
  'InMemorySessionRepository (test fake)',
  inMemory(() => new InMemorySessionRepository()),
)
layoutRepositoryContract(
  'SqliteLayoutRepository',
  sqlite((db) => new SqliteLayoutRepository(db)),
)
layoutRepositoryContract(
  'InMemoryLayoutRepository (test fake)',
  inMemory(() => new InMemoryLayoutRepository()),
)
