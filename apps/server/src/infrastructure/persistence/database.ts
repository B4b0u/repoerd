import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

export type AppDatabase = BetterSQLite3Database<typeof schema>

// Same relative depth from src/ and dist/: <app>/{src,dist}/infrastructure/persistence → <app>/drizzle
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url))

/** Reads a page of the file: throws when SQLite cannot answer (closed, locked, unreadable). */
export function pingDatabase(db: AppDatabase): void {
  db.get(sql`SELECT 1 FROM instance_config LIMIT 1`)
}

export function openDatabase(filePath: string): { db: AppDatabase; close: () => void } {
  if (filePath !== ':memory:') mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true })
  const sqlite = new Database(filePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle({ client: sqlite, schema })
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  return { db, close: () => sqlite.close() }
}
