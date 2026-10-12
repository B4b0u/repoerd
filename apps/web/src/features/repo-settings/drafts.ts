import type { ManualSource } from '@repoerd/model'

/** A source being edited: the paths are typed one per line. */
export interface SourceDraft {
  key: number
  name: string
  format: ManualSource['format']
  pathsText: string
}

export const toDrafts = (sources: ManualSource[]): SourceDraft[] =>
  sources.map((source, key) => ({
    key,
    name: source.name,
    format: source.format,
    pathsText: source.paths.join('\n'),
  }))

export const toSources = (drafts: SourceDraft[]): ManualSource[] =>
  drafts.map((draft) => ({
    name: draft.name.trim(),
    format: draft.format,
    paths: draft.pathsText
      .split('\n')
      .map((path) => path.trim())
      .filter((path) => path !== ''),
  }))

export const emptyDraft = (key: number): SourceDraft => ({
  key,
  name: '',
  format: 'prisma',
  pathsText: '',
})
