import { expect, mainCanvas, test } from './fixtures'

test('a link to a diagram restores the page and its view', async ({ page }) => {
  await page.goto('/acme/shop-prisma?active=orders')
  await expect(page.getByRole('complementary', { name: 'Details of orders' })).toBeVisible()
  await expect(mainCanvas(page).locator('.react-flow__node[data-id="orders"]')).toBeVisible()
})

test('a link to the administration opens it', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/admin$/)
})
