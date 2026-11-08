import type { DetectedSource } from './detection.js'

/** Which schema formats a repository holds, as detection found them on its default branch. */
export type RepoSchemaFormat = 'prisma' | 'drizzle' | 'both' | 'none'

/** A source with a `problem` still counts: it was found, even if it cannot be read. */
export function repoFormatOf(detected: readonly DetectedSource[]): RepoSchemaFormat {
  const prisma = detected.some(({ source }) => source.format === 'prisma')
  const drizzle = detected.some(({ source }) => source.format === 'drizzle')
  if (prisma && drizzle) return 'both'
  if (prisma) return 'prisma'
  if (drizzle) return 'drizzle'
  return 'none'
}
