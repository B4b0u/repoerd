import type { CompareMode, DbSchema, DetectedSource } from '@repoerd/model'
import type { CompareError, ComparisonView } from '../../domain/branch-compare.js'
import type { SchemaOutcome } from '../../domain/branch-schema.js'
import { pickCompareSources } from '../../domain/compare-sources.js'
import { defaultSource } from '../../domain/default-source.js'
import type { KnownRepo } from '../../domain/repo.js'
import { err, ok, type Result } from '../../domain/result.js'
import type { GitHost } from '../ports/git-host.js'
import type { RepoSettingsRepository } from '../ports/repo-settings.js'
import { type CommitSchemas, toSourceSummary } from '../services/commit-schemas.js'

export interface CompareBranchSchemasInput {
  repo: KnownRepo
  /** The reference branch ("before"). */
  base: string
  /** The compared branch ("after"); the default branch when absent. */
  head?: string
  mode: CompareMode
  sourceId?: string
}

export type CompareBranchSchemas = (
  input: CompareBranchSchemasInput,
) => Promise<Result<ComparisonView, CompareError>>

interface Deps {
  gitHost: GitHost
  settings: RepoSettingsRepository
  commitSchemas: CommitSchemas
}

/** A source missing on one side is an empty schema there: everything shows added or removed. */
const EMPTY_SCHEMA: DbSchema = { tables: {}, enums: {}, relationships: [] }

export function makeCompareBranchSchemas(deps: Deps): CompareBranchSchemas {
  return async ({ repo, base, head: requestedHead, mode, sourceId }) => {
    const summary = await deps.gitHost.getRepository(repo)
    if (!summary) return err({ kind: 'repo-not-found' })

    const head = requestedHead ?? summary.defaultBranch
    if (head === base) return err({ kind: 'same-branch' })
    const [headSha, baseSha] = await Promise.all([
      deps.gitHost.resolveBranch(repo, head),
      deps.gitHost.resolveBranch(repo, base),
    ])
    if (!headSha) return err({ kind: 'branch-not-found', side: 'head', branch: head })
    if (!baseSha) return err({ kind: 'branch-not-found', side: 'base', branch: base })

    const mergeBaseSha =
      mode === 'merge-base' ? await deps.gitHost.getMergeBase(repo, baseSha, headSha) : null
    if (mode === 'merge-base' && !mergeBaseSha) return err({ kind: 'no-common-history' })
    const beforeSha = mergeBaseSha ?? baseSha

    const manual = await deps.settings.get(repo)
    // The fork point can be the head itself: detect that commit once for both sides.
    const afterDetection = deps.commitSchemas.detect(repo, headSha, manual)
    const [before, after] = await Promise.all([
      beforeSha === headSha ? afterDetection : deps.commitSchemas.detect(repo, beforeSha, manual),
      afterDetection,
    ])
    const selectedId =
      sourceId ??
      defaultSource(after.detected)?.source.id ??
      defaultSource(before.detected)?.source.id ??
      null
    const picked =
      selectedId === null ? {} : pickCompareSources(before.detected, after.detected, selectedId)
    // A source that matches no file (a declared one, before its files exist) counts as absent.
    const usable = (selected: DetectedSource | undefined): selected is DetectedSource =>
      selected !== undefined && selected.problem?.kind !== 'source-empty'
    const oneSideUsable = usable(picked.before) || usable(picked.after)
    const outcome = async (
      commitSha: string,
      selected: DetectedSource | undefined,
    ): Promise<SchemaOutcome> => {
      if (selectedId === null) return { ok: false, failure: { kind: 'no-schema-found' } }
      // Present on one side only: everything shows added or removed.
      if (oneSideUsable && !usable(selected)) return { ok: true, schema: EMPTY_SCHEMA }
      if (!selected)
        return { ok: false, failure: { kind: 'source-not-found', sourceId: selectedId } }
      return deps.commitSchemas.outcomeFor(repo, commitSha, selected)
    }
    const [beforeSide, afterSide] = await Promise.all([
      outcome(beforeSha, picked.before).then((result) => ({
        commitSha: beforeSha,
        outcome: result,
      })),
      outcome(headSha, picked.after).then((result) => ({ commitSha: headSha, outcome: result })),
    ])

    return ok({
      repo,
      mode,
      base: { branch: base, commitSha: baseSha },
      head: { branch: head, commitSha: headSha },
      mergeBaseSha,
      before: beforeSide,
      after: afterSide,
      sources: after.detected.map(toSourceSummary),
      selectedSourceId: picked.after?.source.id ?? selectedId,
      treeTruncated: before.truncated || after.truncated,
    })
  }
}
