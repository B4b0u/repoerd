import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import main from '../src/main.tsx?raw'

describe('zod config', () => {
  it('turns off the JIT compilation that the content security policy would block', async () => {
    await import('../src/shared/api/zod-config')
    expect(z.config().jitless).toBe(true)
  })

  it('is the first import of the entry point', () => {
    expect(main.trimStart().startsWith("import './shared/api/zod-config'")).toBe(true)
  })
})
