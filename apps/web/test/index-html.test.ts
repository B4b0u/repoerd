// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import html from '../index.html?raw'
import script from '../public/theme-init.js?raw'

afterEach(() => {
  delete document.documentElement.dataset.theme
})

describe('index.html', () => {
  it('has no inline script, which the content security policy would block', () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
    expect(html).toMatch(/<script src="\/theme-init\.js"><\/script>[\s\S]*<\/head>/)
  })

  it('applies the saved theme before the first paint, dark by default', () => {
    new Function(script)()
    expect(document.documentElement.dataset.theme).toBe('dark')
    localStorage.setItem('repoerd:theme', 'light')
    new Function(script)()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
