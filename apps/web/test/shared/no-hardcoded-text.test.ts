import { describe, expect, it } from 'vitest'

const sources = import.meta.glob<string>('../../src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Generated shadcn/ui primitives (lowercase files) stay as generated. */
const isPrimitive = (path: string) => /\/shared\/ui\/[a-z-]+\.tsx$/.test(path)

/** Literal texts allowed outside the catalogues: the product name and code samples. */
const ALLOWED = new Set(['RepoERD', 'XXXX-XXXX-XXXX', 'acme, another-org'])

/**
 * Statements and type members caught between two tags or generics (`/>` then `return <`,
 * `Set<string>` then `<`). Anchored to the start of the whole text (no `m` flag): one code-like
 * line must not hide a multi-line text.
 */
const isCode = (text: string) => /^(?:return|case\b)|^\s*(?:[a-z]+[A-Z]\w*|\w+\?): /.test(text)

function literalTexts(source: string): string[] {
  const texts: string[] = []
  // JSX text between tags, such as <span>Save</span> (the arrows => and -> are not tags).
  for (const match of source.matchAll(/(?<![=-])>([^<>{}()=;`]*[A-Za-z][^<>{}()=;`]*)</g)) {
    const text = (match[1] ?? '').trim()
    if (!isCode(text)) texts.push(text)
  }
  // Literal accessible names, titles, placeholders and alternative texts.
  for (const match of source.matchAll(
    /\b(?:aria-label|title|placeholder|alt)="([^"]*[A-Za-z][^"]*)"/g,
  )) {
    texts.push(match[1] ?? '')
  }
  return texts.filter((text) => !ALLOWED.has(text))
}

describe('interface texts', () => {
  it('all come from the catalogues', () => {
    const found = Object.entries(sources)
      .filter(([path]) => !isPrimitive(path))
      .flatMap(([path, source]) => literalTexts(source).map((text) => `${path}: ${text}`))
    expect(found).toEqual([])
  })
})

describe('the guard itself', () => {
  it.each([
    ['JSX text', '<span>Save</span>', 'Save'],
    ['a button label', '<Button>Remove</Button>', 'Remove'],
    ['a sentence', '<p>Nothing to see here yet</p>', 'Nothing to see here yet'],
    ['an accessible name', '<button aria-label="Close" />', 'Close'],
    ['a placeholder', '<input placeholder="Search" />', 'Search'],
    ['a title', '<a title="Open the repository" />', 'Open the repository'],
    [
      'a text with a code-like later line',
      '<p>Hello there\n  isOpen: yes</p>',
      'Hello there\n  isOpen: yes',
    ],
  ])('reports %s', (_name, source, expected) => {
    expect(literalTexts(source)).toEqual([expected])
  })

  it('ignores the return and case lines of a switch between two tags', () => {
    const source = `switch (kind) {
  case 'a':
    return <A />
  case 'b':
    return <B />
}`
    expect(literalTexts(source)).toEqual([])
  })

  it('ignores TypeScript members and generics between two tags', () => {
    const source = `interface Props {
  items: Array<string>
  label?: Array<number>
  onOpen: Set<string>
  isOpen: Set<string>
}`
    expect(literalTexts(source)).toEqual([])
  })

  it('ignores the allowed texts', () => {
    expect(literalTexts('<b>RepoERD</b><i>XXXX-XXXX-XXXX</i>')).toEqual([])
  })
})
