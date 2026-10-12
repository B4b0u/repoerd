import { describe, expect, it } from 'vitest'
import { preparePrismaSchema, restoreLineNumbers } from '../src/parse/prepare-prisma.js'
import { stripAnsi } from '../src/parse/strip-ansi.js'

describe('preparePrismaSchema', () => {
  it('blanks the generators, keeping the line numbers, and adds one with the preview features', () => {
    const { text } = preparePrismaSchema(
      'generator client {\n  provider = "prisma-client"\n}\nmodel A {\n  id Int @id\n}\n',
    )
    expect(text.split('\n').slice(0, 6)).toEqual(['', '', '', 'model A {', '  id Int @id', '}'])
    expect(text).toContain(
      'generator repoerd {\n  provider        = "prisma-client-js"\n  previewFeatures = ["multiSchema", "views", "postgresqlExtensions"]\n}\n',
    )
  })

  it('adds a placeholder url to a datasource without one (Prisma 7), and only then', () => {
    expect(
      preparePrismaSchema('datasource db {\n  provider = "postgresql"\n}\n').text.startsWith(
        'datasource db {\n  url = "postgresql://localhost/repoerd"\n  provider = "postgresql"\n}\n',
      ),
    ).toBe(true)
    expect(
      preparePrismaSchema(
        'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n',
      ).text,
    ).not.toContain('localhost/repoerd')
  })

  it('reads files with Windows line endings', () => {
    const { text } = preparePrismaSchema(
      'generator client {\r\n  provider = "prisma-client"\r\n}\r\ndatasource db {\r\n  provider = "postgresql"\r\n}\r\n',
    )
    expect(
      text.startsWith('\n\n\ndatasource db {\n  url = "postgresql://localhost/repoerd"\n'),
    ).toBe(true)
  })

  it('lists the tables of the views, under their @@map and @@schema', () => {
    const { viewTables } = preparePrismaSchema(
      [
        'view Active {',
        '  id Int @unique',
        '}',
        'view Monthly {',
        '  id Int @unique',
        '  @@map("monthly_totals")',
        '  @@schema("reporting")',
        '}',
        'model A {',
        '  id Int @id',
        '}',
        '',
      ].join('\n'),
    )
    expect(viewTables).toEqual(['Active', 'reporting.monthly_totals'])
  })

  it('gives a placeholder url to a datasource with only a directUrl or a commented url', () => {
    const only = (body: string) => preparePrismaSchema(`datasource db {\n${body}\n}\n`).text
    expect(only('  directUrl = env("X")')).toContain('localhost/repoerd')
    expect(only('  // url = env("X")')).toContain('localhost/repoerd')
  })

  it('reads a block header with a trailing comment', () => {
    const { text } = preparePrismaSchema('datasource db { // main\n  provider = "postgresql"\n}\n')
    expect(text).toContain('localhost/repoerd')
  })

  it('appends no generator when a block is left open, so Prisma reports the real error', () => {
    const { text } = preparePrismaSchema('model A {\n  id Int @id\n')
    expect(text).not.toContain('repoerd')
    expect(text).not.toContain('prisma-client-js')
  })

  it('ignores a commented @@map inside a view', () => {
    const { viewTables } = preparePrismaSchema('view V {\n  id Int @unique\n  // @@map("old")\n}\n')
    expect(viewTables).toEqual(['V'])
  })

  it('renumbers Prisma errors around the injected url line and drops it', () => {
    const { text, injectedLines } = preparePrismaSchema('datasource db {\n  provider = "x"\n}\n')
    expect(injectedLines).toEqual([2])
    const message = [
      'error: boom',
      '  -->  schema.prisma:3',
      '   | ',
      '[1;94m 1 | [0mdatasource db {',
      '[1;94m 2 | [0m  url = "postgresql://localhost/repoerd"',
      '[1;94m 3 | [0m  provider = "x"',
      '   | ',
    ].join('\n')
    expect(text).toContain('localhost')
    expect(restoreLineNumbers(stripAnsi(message), injectedLines)).toBe(
      [
        'error: boom',
        '  -->  schema.prisma:2',
        '   | ',
        ' 1 | datasource db {',
        ' 2 |   provider = "x"',
        '   | ',
      ].join('\n'),
    )
  })

  it('keeps the gutter aligned when a line number loses a digit', () => {
    expect(restoreLineNumbers('  -->  schema.prisma:10\n 10 | x', [2])).toBe(
      '  -->  schema.prisma:9\n  9 | x',
    )
  })
})
