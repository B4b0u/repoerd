import type { DbSchema, RepoRef, SchemaFailure, SchemaFormat, SourceProblem } from '@repoerd/model'

export interface SourceSummary {
  id: string
  name: string
  format: SchemaFormat
  problem: SourceProblem | null
}

export type SchemaOutcome = { ok: true; schema: DbSchema } | { ok: false; failure: SchemaFailure }

export interface BranchSchemaView {
  repo: RepoRef
  branch: string
  commitSha: string
  sources: SourceSummary[]
  selectedSourceId: string | null
  outcome: SchemaOutcome
  /** GitHub cut the repository tree: schema detection may be incomplete. */
  treeTruncated: boolean
}

export type BranchSchemaError =
  | { kind: 'repo-not-found' }
  | { kind: 'branch-not-found'; branch: string }
