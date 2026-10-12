import { expect, mainCanvas, test } from './fixtures'

// The API answers 404 repo_moved for the old name before the page follows the move; no other
// failed load is tolerated (acme/shop-prisma requests do not match: the name ends the pattern).
test.use({ allowedFailedUrls: [/\/api\/repos\/acme\/shop(\/|\?|$)/] })

// acme/shop-prisma declares the former name acme/shop (fixtures/repos/acme/shop-prisma/repo.json).
test('an old link of a renamed repository opens it under its current name', async ({ page }) => {
  await page.goto('/acme/shop?mode=KEYS_ONLY&active=orders')
  await expect(page).toHaveURL(/\/acme\/shop-prisma\?mode=KEYS_ONLY&active=orders$/)
  await expect(mainCanvas(page).locator('.react-flow__node[data-id="orders"]')).toBeVisible()
  // The URL is replaced, not pushed: going back does not land on the old link.
  await page.goBack()
  await expect(page).toHaveURL('about:blank')
})
