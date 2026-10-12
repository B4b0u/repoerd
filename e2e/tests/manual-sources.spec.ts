import { expect, mainCanvas, test } from './fixtures'

// acme/multi-source has a Prisma source (accounts) and a Drizzle source (invoices).
test('manual sources replace detection until they are removed', async ({ page }) => {
  await page.goto('/acme/multi-source/settings')
  await expect(
    page.getByRole('heading', { name: 'Schema sources of acme/multi-source' }),
  ).toBeVisible()
  await expect(page.getByText('No source declared: automatic detection is on.')).toBeVisible()

  await page.getByRole('button', { name: 'Add a source' }).click()
  await page.getByLabel('Name', { exact: true }).fill('billing')
  await page.getByRole('combobox', { name: 'Format' }).click()
  await page.getByRole('option', { name: 'Drizzle' }).click()
  await page.getByLabel('Paths (one per line)').fill('packages/billing/src/schema.ts')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved. These sources replace automatic detection.')).toBeVisible()

  await page.getByRole('link', { name: 'Back to the diagram' }).click()
  await expect(page).toHaveURL(/\/acme\/multi-source(\?|$)/)
  const canvas = mainCanvas(page)
  await expect(canvas.locator('.react-flow__node[data-id="invoices"]')).toBeVisible()
  await expect(canvas.locator('.react-flow__node[data-id="accounts"]')).toHaveCount(0)

  // Automatic detection again: reload-after-move.spec.ts opens this repository too.
  await page.goto('/acme/multi-source/settings')
  await page.getByRole('button', { name: 'Remove source 1' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved. Automatic detection is back on.')).toBeVisible()
})
