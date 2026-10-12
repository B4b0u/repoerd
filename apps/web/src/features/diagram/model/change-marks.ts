import type { DiffStatus } from '@repoerd/model'
import type { ChangeStatus } from './diff-view'

/** Never colour alone: every change carries its symbol. */
export const MARK: Record<ChangeStatus, string> = { added: '+', removed: '−', modified: '~' }

/** Text colour of each change (Tailwind classes on the diff tokens of theme.css). */
export const TONE: Record<ChangeStatus, string> = {
  added: 'text-diff-added',
  removed: 'text-diff-removed',
  modified: 'text-diff-modified',
}

/** The change of an item; undefined when it did not change. */
export const changeOf = (status: DiffStatus | undefined): ChangeStatus | undefined =>
  status && status !== 'unchanged' ? status : undefined
