import picomatch from 'picomatch'
import { describe, expect, it } from 'vitest'
import { compileGlob, GLOB_OPTIONS } from '../src/detect/glob-match.js'

const patterns = [
  'src/db/*.ts',
  '**/schema.ts',
  'src/**/*.schema.ts',
  'packages/*/src/schema/*.ts',
  'a/**/b/**/*.ts',
  '**/*',
  '*.ts',
  '.config/*.ts',
  'src/{a,b}.ts',
]
const paths = [
  'src/db/a.ts',
  'src/db/x/a.ts',
  'schema.ts',
  'a/b/schema.ts',
  'src/user.schema.ts',
  'src/x/y/user.schema.ts',
  'packages/api/src/schema/users.ts',
  'packages/api/src/schema/x/users.ts',
  'a/b.ts',
  'a/x/b/y/z.ts',
  'a/b/b/c.ts',
  'index.ts',
  '.config/db.ts',
  '.hidden/x.ts',
  'src/a.ts',
  'src/{a,b}.ts',
  'README.md',
]

describe('compileGlob', () => {
  for (const pattern of patterns) {
    it(`agrees with picomatch on ${pattern}`, () => {
      const whole = picomatch(pattern, GLOB_OPTIONS)
      const segmented = compileGlob(pattern)
      for (const path of paths)
        expect([pattern, path, segmented(path)]).toEqual([pattern, path, whole(path)])
    })
  }
})
