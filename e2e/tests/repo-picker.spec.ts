import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

// The tests share one database: a repository other specs opened is already a recent, so each
// check looks inside its own section, never at a link by name alone.
const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

test('a starred repository moves to the favourites, also after a reload', async ({ page }) => {
  await page.goto('/')
  const all = section(page, 'All repositories')
  try {
    await all.getByRole('button', { name: 'Add acme/blog-drizzle to favourites' }).click()
    const favourites = section(page, 'Favourites')
    await expect(
      favourites.getByRole('link', { name: 'acme/blog-drizzle', exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(
      favourites.getByRole('link', { name: 'acme/blog-drizzle', exact: true }),
    ).toBeVisible()
  } finally {
    // Back to the initial state for the specs that follow; nothing to undo if the star failed.
    await page.goto('/')
    await expect(all).toBeVisible()
    const unstar = section(page, 'Favourites').getByRole('button', {
      name: 'Remove acme/blog-drizzle from favourites',
    })
    if ((await unstar.count()) > 0) {
      await unstar.click()
      await expect(section(page, 'Favourites')).toHaveCount(0)
    }
  }
})

test('a repository whose diagram was opened is listed in the recents', async ({ page }) => {
  await page.goto('/acme/shop-prisma')
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await page.goto('/')
  const card = section(page, 'Recent')
    .getByRole('listitem')
    .filter({
      has: page.getByRole('link', { name: 'acme/shop-prisma', exact: true }),
    })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Opened')
})

test('repositories without a schema are hidden by default and shown on request', async ({
  page,
}) => {
  await page.goto('/')
  const all = section(page, 'All repositories')
  const noSchema = all.getByRole('link', { name: 'acme/no-schema', exact: true })
  // Formats arrive by polling: once acme/no-schema is detected, the line about hidden ones appears.
  await expect(all.getByText(/repositor(y|ies) without a schema hidden/)).toBeVisible({
    timeout: 20_000,
  })
  await expect(all.getByRole('link', { name: 'acme/blog-drizzle', exact: true })).toBeVisible()
  await expect(noSchema).toHaveCount(0)

  await all.getByRole('button', { name: 'Show all repositories' }).click()
  await expect(noSchema).toBeVisible()
  await expect(
    all
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: 'acme/no-schema', exact: true }) }),
  ).toContainText('No schema')

  await page.reload()
  await expect(noSchema).toBeVisible()
  await expect(page.getByRole('tab', { name: 'All', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

test('a search narrows the list and hides the favourites and recents', async ({ page }) => {
  // A diagram opened by this test: the recents are shown before the search.
  await page.goto('/acme/shop-prisma')
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await page.goto('/')
  await expect(section(page, 'Recent')).toBeVisible()
  await page.getByRole('searchbox', { name: 'Filter repositories' }).fill('storefront')
  const all = section(page, 'All repositories')
  await expect(all.getByRole('link')).toHaveCount(1)
  await expect(all.getByRole('link', { name: 'acme/storefront', exact: true })).toBeVisible()
  await expect(section(page, 'Recent')).toHaveCount(0)
  await expect(section(page, 'Favourites')).toHaveCount(0)
})
