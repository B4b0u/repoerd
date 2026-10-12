import type { SchemaFormat } from './schema.js'

export interface RepoRef {
  owner: string
  name: string
}

export interface SchemaSource {
  /** Stable identifier: the path of the schema file, folder or config that defines the source. */
  id: string
  name: string
  format: SchemaFormat
  origin: 'detected' | 'manual'
}

export interface TablePosition {
  table: string
  x: number
  y: number
}

/** A schema source declared by hand in the repository settings (replaces automatic detection). */
export interface ManualSource {
  name: string
  format: SchemaFormat
  /** Files, folders or globs, relative to the repository root. */
  paths: string[]
}

/** Manual ids never collide with detected ones, which are repository paths. */
export const manualSourceId = (name: string) => `manual:${name}`
