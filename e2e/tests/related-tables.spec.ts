import { expect, mainCanvas, test } from './fixtures'

test('the related tables of a table open in the main view', async ({ page }) => {
  await page.goto('/acme/shop-prisma?active=users')
  await page.getByRole('button', { name: 'Open in main view' }).click()
  await expect(page.getByText('Tables related to')).toBeVisible()
  await expect(page).toHaveURL(/focus=users/)
  const canvas = mainCanvas(page)
  await expect(canvas.locator('.react-flow__node')).toHaveCount(2)
  await expect(canvas.locator('.react-flow__node[data-id="orders"]')).toBeVisible()
})
