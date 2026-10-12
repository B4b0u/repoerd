import type {
  BranchSchemaError,
  BranchSchemaView,
  SchemaOutcome,
} from '../../domain/branch-schema.js'
import { defaultSource } from '../../domain/default-source.js'
import type { KnownRepo } from '../../domain/repo.js'
import { err, ok, type Result } from '../../domain/result.js'
import type { GitHost } from '../ports/git-host.js'
import type { RepoSettingsRepository } from '../ports/repo-settings.js'
import {
  type CommitSchemaDeps,
  type CommitSchemas,
  makeCommitSchemas,
  toSourceSummary,
} from '../services/commit-schemas.js'

export interface GetBranchSchemaInput {
  repo: KnownRepo
  branch?: string
  sourceId?: string
}

export type GetBranchSchema = (
  input: GetBranchSchemaInput,
) => Promise<Result<BranchSchemaView, BranchSchemaError>>

type Deps = { gitHost: GitHost; settings: RepoSettingsRepository } & (
  | {
      /** Shared with the other use cases, so their requests share parses (main.ts). */
      commitSchemas: CommitSchemas
    }
  /** A private CommitSchemas is built from these (tests). */
  | Omit<CommitSchemaDeps, 'gitHost'>
)

export function makeGetBranchSchema(deps: Deps): GetBranchSchema {
  const { detect, outcomeFor } =
    'commitSchemas' in deps ? deps.commitSchemas : makeCommitSchemas(deps)

  return async ({ repo, branch: requestedBranch, sourceId }) => {
    const summary = await deps.gitHost.getRepository(repo)
    if (!summary) return err({ kind: 'repo-not-found' })

    const branch = requestedBranch ?? summary.defaultBranch
    const commitSha = await deps.gitHost.resolveBranch(repo, branch)
    if (!commitSha) return err({ kind: 'branch-not-found', branch })

    const manual = await deps.settings.get(repo)
    const { detected, truncated } = await detect(repo, commitSha, manual)
    const view = (selectedSourceId: string | null, outcome: SchemaOutcome): BranchSchemaView => ({
      repo,
      branch,
      commitSha,
      sources: detected.map(toSourceSummary),
      selectedSourceId,
      outcome,
      treeTruncated: truncated,
    })

    if (detected.length === 0) {
      return ok(view(null, { ok: false, failure: { kind: 'no-schema-found' } }))
    }
    const selected =
      sourceId === undefined
        ? defaultSource(detected)
        : detected.find((d) => d.source.id === sourceId)
    if (!selected) {
      return ok(
        view(sourceId ?? null, {
          ok: false,
          failure: { kind: 'source-not-found', sourceId: sourceId ?? '' },
        }),
      )
    }
    return ok(view(selected.source.id, await outcomeFor(repo, commitSha, selected)))
  }
}
