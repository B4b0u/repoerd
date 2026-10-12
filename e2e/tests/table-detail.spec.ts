import { expect, mainCanvas, test } from './fixtures'

test('a click on a table opens its details; closing them clears the URL', async ({ page }) => {
  await page.goto('/acme/shop-prisma')
  const orders = mainCanvas(page).locator('.react-flow__node[data-id="orders"]')
  await expect(orders).toBeVisible()
  await orders.click()
  await expect(page).toHaveURL(/active=orders/)

  const details = page.getByRole('complementary', { name: 'Details of orders' })
  await expect(details.getByRole('heading', { name: 'orders' })).toBeVisible()
  await expect(details.getByText('user_id', { exact: true }).first()).toBeVisible()
  await expect(details.getByText('Foreign key').first()).toBeVisible()

  await details.getByRole('button', { name: 'Close details' }).click()
  await expect(details).toHaveCount(0)
  await expect(page).not.toHaveURL(/active=/)
})
