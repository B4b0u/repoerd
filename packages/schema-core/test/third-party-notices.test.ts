import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const NOTICES = read('../../../THIRD_PARTY_NOTICES.md')
/** The licence shipped in the installed package (the patch never touches it). */
const LIAM_LICENSE = read('../node_modules/@liam-hq/schema/LICENSE')
/** The files of the published package that the patch modifies, read from the patch itself. */
const PATCHED_FILES = [
  ...read('../../../patches/@liam-hq__schema@0.6.1.patch').matchAll(/^diff --git a\/(\S+)/gm),
].map((match) => match[1] as string)

describe('THIRD_PARTY_NOTICES.md', () => {
  it('credits @liam-hq/schema 0.6.1, its copyright holder and its licence', () => {
    expect(NOTICES).toContain('## @liam-hq/schema 0.6.1')
    expect(NOTICES).toContain('Copyright (c) 2024 ROUTE06, Inc.')
    expect(NOTICES).toContain('Apache License, Version 2.0')
  })

  it.each(PATCHED_FILES)('lists the modification of %s', (file) => {
    expect(NOTICES).toContain(`\`${file}\``)
  })

  it('carries the full text of the licence shipped with the package', () => {
    const text = LIAM_LICENSE.slice(LIAM_LICENSE.indexOf('Apache License')).trimEnd()
    expect(text).toContain('END OF TERMS AND CONDITIONS')
    expect(NOTICES).toContain(text)
  })
})
