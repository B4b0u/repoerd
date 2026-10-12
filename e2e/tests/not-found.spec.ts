import { expect, test } from './fixtures'

// These pages provoke 404 answers on purpose. One pattern only: Playwright reads a two-element
// array given to test.use() as a fixture tuple, not as a list of values.
test.use({
  allowedFailedUrls: [/\/api\/repos\/acme\/(nope(\/|\?|$)|shop-prisma\/schema\?branch=nope)/],
})

test('an unknown page says so', async ({ page }) => {
  await page.goto('/a/b/c/d')
  await expect(page.getByText('Page not found.')).toBeVisible()
  await expect(page).toHaveTitle(/Page not found/)
})

test('an unknown repository says so', async ({ page }) => {
  await page.goto('/acme/nope')
  await expect(page.getByText('Repository not found.')).toBeVisible()
})

test('an unknown branch is named', async ({ page }) => {
  await page.goto('/acme/shop-prisma?branch=nope')
  await expect(page.getByText('Branch "nope" not found.')).toBeVisible()
})
