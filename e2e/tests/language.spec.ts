import { expect, test } from './fixtures'

test('the chosen language survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'dev' }).click()
  await page.getByRole('menuitemradio', { name: 'Français' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await page.getByRole('button', { name: 'dev' }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Français' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})
