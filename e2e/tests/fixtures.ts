import { test as base, expect, type Locator, type Page } from '@playwright/test'

/** Every test fails on a console error, an uncaught exception or a CSP violation. */
export const test = base.extend<{ guard: undefined; allowedFailedUrls: RegExp[] }>({
  /** URLs whose failed load a test provokes on purpose (a 404 it expects); other errors still fail. */
  allowedFailedUrls: [[], { option: true }],
  guard: [
    async ({ page, allowedFailedUrls }, use) => {
      const problems: string[] = []
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        if (allowedFailedUrls.some((pattern) => pattern.test(message.location().url))) return
        problems.push(`console error: ${message.text()}`)
      })
      page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`)
        })
      })
      await use(undefined)
      expect(problems, problems.join('\n')).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/** The main diagram: the detail panel holds its own small preview, with the same table nodes. */
export function mainCanvas(page: Page): Locator {
  return page
    .locator('.react-flow')
    .filter({ has: page.getByRole('combobox', { name: 'Display mode' }) })
}
