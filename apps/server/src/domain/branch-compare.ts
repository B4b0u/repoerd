import type { CompareMode, RepoRef } from '@repoerd/model'
import type { SchemaOutcome, SourceSummary } from './branch-schema.js'

export interface BranchHead {
  branch: string
  commitSha: string
}

/** One side of a comparison: the commit read and its schema (or why there is none). */
export interface CompareSide {
  commitSha: string
  outcome: SchemaOutcome
}

export interface ComparisonView {
  repo: RepoRef
  mode: CompareMode
  /** The reference branch ("before") and its head. */
  base: BranchHead
  /** The compared branch ("after"): the displayed one. */
  head: BranchHead
  /** The fork point in 'merge-base' mode; null in 'direct' mode. */
  mergeBaseSha: string | null
  /** The merge base, or the reference head in 'direct' mode. */
  before: CompareSide
  after: CompareSide
  /** Sources of the compared branch: they feed the source picker. */
  sources: SourceSummary[]
  selectedSourceId: string | null
  /** GitHub cut the tree of either side: detection may be incomplete. */
  treeTruncated: boolean
}

export type CompareError =
  | { kind: 'repo-not-found' }
  | { kind: 'branch-not-found'; side: 'base' | 'head'; branch: string }
  | { kind: 'same-branch' }
  | { kind: 'no-common-history' }
