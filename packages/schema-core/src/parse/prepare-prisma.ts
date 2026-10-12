import { qualifiedTableName } from './liam-patch.js'

/*
 * Liam validates Prisma schemas with Prisma 6.8. Before that, the text is rewritten where a
 * current Prisma accepts what Prisma 6.8 refuses, without changing the data model: every
 * `generator` block is blanked (line numbers stay) and one generator enabling the preview features
 * is appended (`multiSchema` is generally available since Prisma 6.13; `views` and
 * `postgresqlExtensions` are enabled because the user's generator, which could enable them, is
 * blanked); a `datasource` without `url` (Prisma 7 moved
 * it to prisma.config) gets a placeholder `url` (the lines after it move down by one).
 */

/** Unknown preview features are refused by Prisma 6.8: only these, which it knows, are enabled. */
export const PRISMA_PREVIEW_FEATURES = ['multiSchema', 'views', 'postgresqlExtensions'] as const
export const PLACEHOLDER_DATASOURCE_URL = 'postgresql://localhost/repoerd'

const BLOCK_START =
  /^\s*(generator|datasource|model|view|enum|type)\s+([A-Za-z_]\w*)\s*\{\s*(\/\/.*)?$/
/** Any line opening a block, even one whose header is not valid Prisma. */
const OPENER = /\{\s*(\/\/.*)?$/
const COMMENT_LINE = /^\s*\/\//
const BLOCK_END = /^\s*\}\s*(\/\/.*)?$/
const URL_PROPERTY = /^\s*url\s*=/
const MAP_ATTRIBUTE = /@@map\(\s*(?:name\s*:\s*)?"([^"]*)"/
const SCHEMA_ATTRIBUTE = /@@schema\(\s*"([^"]*)"/

interface Block {
  keyword: string
  name: string
  /** Line index of the header. */
  start: number
  /** Line index of the closing brace. */
  end: number
}

/** Top-level blocks, one linear pass: a block ends at the first line holding only `}`. */
function blocksOf(lines: readonly string[]): { blocks: Block[]; unclosed: boolean } {
  const blocks: Block[] = []
  let open: Omit<Block, 'end'> | null = null
  let unrecognised = false
  lines.forEach((line, index) => {
    if (open === null) {
      const header = BLOCK_START.exec(line)
      if (header) open = { keyword: header[1] ?? '', name: header[2] ?? '', start: index }
      else if (OPENER.test(line) && !COMMENT_LINE.test(line)) unrecognised = true
    } else if (BLOCK_END.test(line)) {
      blocks.push({ ...open, end: index })
      open = null
    }
  })
  return { blocks, unclosed: open !== null || unrecognised }
}

export interface PreparedPrisma {
  /** The schema Liam parses. */
  text: string
  /** Keys of the tables Liam makes of `view` blocks: removed after parsing, and counted. */
  viewTables: string[]
  /** 1-based lines of the placeholder urls in `text`: see restoreLineNumbers. */
  injectedLines: number[]
}

export function preparePrismaSchema(input: string): PreparedPrisma {
  const lines = input.split(/\r?\n/)
  const output = [...lines]
  const inserted = new Map<number, string>()
  const viewTables: string[] = []
  const { blocks, unclosed } = blocksOf(lines)
  // A block left open: Prisma must report that real error, not one about our additions.
  if (unclosed) return { text: input, viewTables: [], injectedLines: [] }
  for (const block of blocks) {
    const body = lines.slice(block.start + 1, block.end)
    if (block.keyword === 'generator') {
      for (let index = block.start; index <= block.end; index++) output[index] = ''
    } else if (block.keyword === 'datasource' && !body.some((line) => URL_PROPERTY.test(line))) {
      inserted.set(block.start, `  url = "${PLACEHOLDER_DATASOURCE_URL}"`)
    } else if (block.keyword === 'view') {
      // Attribute lines only: a commented `// @@map("old")` does not count.
      const text = body.filter((line) => line.trimStart().startsWith('@@')).join('\n')
      const table = MAP_ATTRIBUTE.exec(text)?.[1] ?? block.name
      viewTables.push(qualifiedTableName(SCHEMA_ATTRIBUTE.exec(text)?.[1], table))
    }
  }
  const injectedLines: number[] = []
  const text = output
    .flatMap((line, index) => {
      const after = inserted.get(index)
      if (after === undefined) return [line]
      injectedLines.push(index + 2 + injectedLines.length)
      return [line, after]
    })
    .join('\n')
  const features = PRISMA_PREVIEW_FEATURES.map((feature) => `"${feature}"`).join(', ')
  return {
    text: `${text}\n\ngenerator repoerd {\n  provider        = "prisma-client-js"\n  previewFeatures = [${features}]\n}\n`,
    viewTables,
    injectedLines,
  }
}

const REFERENCE = /(schema\.prisma:)(\d+)/g
const GUTTER = /^(\s*)(\d+)(\s*\|.*)$/

/**
 * Prisma reports lines of the prepared text: the placeholder url lines are dropped from its
 * snippets and the lines after them are numbered as in the user's file.
 */
export function restoreLineNumbers(message: string, injectedLines: readonly number[]): string {
  if (injectedLines.length === 0) return message
  const shift = (line: number) => line - injectedLines.filter((injected) => injected < line).length
  return message
    .split('\n')
    .filter((line) => {
      const gutter = GUTTER.exec(line)
      return !(gutter && injectedLines.includes(Number(gutter[2])))
    })
    .map((line) =>
      line
        .replace(REFERENCE, (_, prefix: string, n: string) => `${prefix}${shift(Number(n))}`)
        .replace(GUTTER, (_, pad: string, n: string, rest: string) => {
          const renumbered = String(shift(Number(n)))
          // Keep the gutter aligned when the number loses a digit (10 -> 9).
          return `${pad}${' '.repeat(n.length - renumbered.length)}${renumbered}${rest}`
        }),
    )
    .join('\n')
}
