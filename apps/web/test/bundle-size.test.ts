import { describe, expect, it } from 'vitest'
import {
  checkBudget,
  cssFiles,
  initialJsFiles,
  largest,
  lazyJsFiles,
} from '../scripts/check-bundle-size'

describe('initialJsFiles', () => {
  it('follows the static imports of the entry, not the dynamic ones', () => {
    expect(
      initialJsFiles({
        'index.html': {
          file: 'assets/index-1.js',
          isEntry: true,
          imports: ['_react.js', '_radix.js'],
          dynamicImports: ['src/DiagramPage.tsx'],
        },
        '_react.js': { file: 'assets/react-2.js' },
        '_radix.js': { file: 'assets/radix-3.js', imports: ['_react.js'] },
        'src/DiagramPage.tsx': { file: 'assets/DiagramPage-4.js', imports: ['_xyflow.js'] },
        '_xyflow.js': { file: 'assets/xyflow-5.js' },
      }),
    ).toEqual(['assets/index-1.js', 'assets/react-2.js', 'assets/radix-3.js'])
  })

  it('fails loudly on a manifest without entry', () => {
    expect(() => initialJsFiles({ 'a.js': { file: 'assets/a.js' } })).toThrow(/entry/)
  })
})

describe('checkBudget', () => {
  const sizes = [
    { file: 'a.js', gzip: 600 },
    { file: 'b.js', gzip: 400 },
  ]
  it('passes at or under the budget', () => {
    expect(checkBudget(sizes, 1000)).toEqual({ total: 1000, ok: true })
  })
  it('fails over the budget', () => {
    expect(checkBudget(sizes, 999)).toEqual({ total: 1000, ok: false })
  })
})

const MANIFEST = {
  'index.html': {
    file: 'assets/index-1.js',
    isEntry: true,
    imports: ['_react.js'],
    dynamicImports: ['src/DiagramPage.tsx'],
    css: ['assets/index-1.css'],
  },
  '_react.js': { file: 'assets/react-2.js' },
  'src/DiagramPage.tsx': {
    file: 'assets/DiagramPage-4.js',
    imports: ['_xyflow.js'],
    css: ['assets/DiagramPage-4.css'],
  },
  '_xyflow.js': { file: 'assets/xyflow-5.js', css: ['assets/xyflow-5.css'] },
  '_xyflow-5.css': { file: 'assets/xyflow-5.css' },
}

describe('lazyJsFiles', () => {
  it('lists the JavaScript loaded after the first page, sorted', () => {
    expect(lazyJsFiles(MANIFEST)).toEqual(['assets/DiagramPage-4.js', 'assets/xyflow-5.js'])
  })
})

describe('cssFiles', () => {
  it('lists every stylesheet once, sorted', () => {
    expect(cssFiles(MANIFEST)).toEqual([
      'assets/DiagramPage-4.css',
      'assets/index-1.css',
      'assets/xyflow-5.css',
    ])
  })
})

describe('largest', () => {
  it('picks the biggest gzip size, or nothing', () => {
    expect(
      largest([
        { file: 'a.js', gzip: 10 },
        { file: 'b.js', gzip: 30 },
        { file: 'c.js', gzip: 20 },
      ]),
    ).toEqual({ file: 'b.js', gzip: 30 })
    expect(largest([])).toBeNull()
  })
})
