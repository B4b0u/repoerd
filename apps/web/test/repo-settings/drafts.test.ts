import { describe, expect, it } from 'vitest'
import { emptyDraft, toDrafts, toSources } from '../../src/features/repo-settings/drafts'

describe('source drafts', () => {
  it('show one path per line and read them back, trimmed, without empty lines', () => {
    const drafts = toDrafts([{ name: 'core', format: 'drizzle', paths: ['src/db', 'lib/**/*.ts'] }])
    expect(drafts).toEqual([
      { key: 0, name: 'core', format: 'drizzle', pathsText: 'src/db\nlib/**/*.ts' },
    ])
    expect(
      toSources([
        { key: 3, name: ' core ', format: 'prisma', pathsText: ' a.prisma \n\n  \nb/ \n' },
      ]),
    ).toEqual([{ name: 'core', format: 'prisma', paths: ['a.prisma', 'b/'] }])
  })

  it('start new sources as Prisma, without name or path', () => {
    expect(emptyDraft(7)).toEqual({ key: 7, name: '', format: 'prisma', pathsText: '' })
  })
})
