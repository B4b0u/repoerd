import type { ManualSource } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { validateManualSources } from '../../src/domain/manual-sources.js'

const source = (patch: Partial<ManualSource> = {}): ManualSource => ({
  name: 'core',
  format: 'prisma',
  paths: ['prisma/schema.prisma'],
  ...patch,
})
const invalid = (input: ManualSource[]) => {
  const result = validateManualSources(input)
  return result.ok ? null : result.error.rejection
}

describe('validateManualSources', () => {
  it('accepts an empty list: back to automatic detection', () => {
    expect(validateManualSources([])).toEqual({ ok: true, value: [] })
  })

  it('trims names and paths, drops empty paths, strips ./ and removes duplicates', () => {
    expect(
      validateManualSources([
        source({
          name: '  core  ',
          paths: [' ./prisma/schema.prisma ', '', '   ', 'prisma/schema.prisma', 'db/**/*.prisma'],
        }),
      ]),
    ).toEqual({
      ok: true,
      value: [
        { name: 'core', format: 'prisma', paths: ['prisma/schema.prisma', 'db/**/*.prisma'] },
      ],
    })
  })

  it('strips every leading ./ of a path', () => {
    expect(
      validateManualSources([source({ paths: ['././prisma/schema.prisma', './././x'] })]),
    ).toEqual({ ok: true, value: [source({ paths: ['prisma/schema.prisma', 'x'] })] })
  })

  it('refuses source names containing control characters', () => {
    for (const name of ['core\u0000', 'co\nre', 'core\u007f']) {
      expect(invalid([source({ name })])).toEqual({ reason: 'name-control-characters' })
    }
  })

  it('limits the number of sources, the name length and the paths', () => {
    expect(invalid(Array.from({ length: 21 }, (_, i) => source({ name: `s${i}` })))).toEqual({
      reason: 'too-many-sources',
      max: 20,
    })
    expect(invalid([source({ name: '   ' })])).toEqual({ reason: 'name-missing' })
    expect(invalid([source({ name: 'x'.repeat(101) })])).toEqual({
      reason: 'name-too-long',
      max: 100,
    })
    expect(invalid([source({ paths: ['', ' '] })])).toEqual({ reason: 'no-path', name: 'core' })
    expect(
      invalid([source({ paths: Array.from({ length: 51 }, (_, i) => `p${i}.prisma`) })]),
    ).toEqual({ reason: 'too-many-paths', name: 'core', max: 50 })
    expect(invalid([source({ paths: ['a'.repeat(501)] })])).toEqual({
      reason: 'path-too-long',
      max: 500,
    })
  })

  it('refuses two sources with the same name, ignoring case', () => {
    expect(invalid([source({ name: 'Core' }), source({ name: 'core ' })])).toEqual({
      reason: 'duplicate-name',
      name: 'core',
    })
  })

  it('refuses paths that are absolute, leave the repository or contain backslashes or control characters', () => {
    for (const path of [
      '/etc/passwd',
      '../other/schema.prisma',
      'db/../../x',
      'db\\schema.prisma',
      'db/\u0000x',
      '..',
      'a/./../b',
      'a/..',
      '.\\x',
    ]) {
      expect(invalid([source({ paths: [path] })])).toEqual({
        reason: 'path-invalid',
        name: 'core',
        path,
      })
    }
    // The leading ./ is stripped before the check, so the reason names the normalised path.
    expect(invalid([source({ paths: ['./../x'] })])).toEqual({
      reason: 'path-invalid',
      name: 'core',
      path: '../x',
    })
  })

  it('only refuses whole .. segments', () => {
    expect(validateManualSources([source({ paths: ['a..b', '..foo', 'db/x..'] })])).toEqual({
      ok: true,
      value: [source({ paths: ['a..b', '..foo', 'db/x..'] })],
    })
  })
})
