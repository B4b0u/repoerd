import { expect, mainCanvas, test } from './fixtures'

// Display mode KEYS_ONLY on purpose: layouts are saved per display mode, and main-journey.spec.ts
// expects the ALL_FIELDS layout of acme/blog-drizzle to be saved for the first time when it opens.
test('a branch is compared with main from its fork point, then directly', async ({ page }) => {
  await page.goto('/acme/blog-drizzle?branch=feature%2Fpost-tags&mode=KEYS_ONLY')
  await expect(mainCanvas(page).locator('.react-flow__node[data-id="tags"]')).toBeVisible()

  // The popover's submit button is also named "Compare", and the popover stays mounted during its
  // 150 ms fade-out: the trigger is looked up in the header only.
  const compare = page.getByRole('banner').getByRole('button', { name: 'Compare', exact: true })
  const dialog = page.getByRole('dialog')

  await compare.click()
  await dialog.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/compare=main/)

  const bar = page.getByRole('region', { name: 'Comparison' })
  await expect(bar).toContainText('feature/post-tags compared with main')
  await expect(bar).toContainText('2 new tables')
  await expect(bar).toContainText('2 modified tables')

  const changes = page.getByRole('region', { name: 'Tables' })
  for (const table of ['post_tags', 'tags', 'posts', 'users']) {
    await expect(changes.getByRole('button', { name: new RegExp(`^${table}`) })).toBeVisible()
  }
  await expect(changes.getByRole('button', { name: /^comments/ })).toHaveCount(0)

  await changes.getByRole('button', { name: /^posts/ }).click()
  const details = page.getByRole('complementary', { name: 'Details of posts' })
  await expect(details.locator('ins', { hasText: 'varchar(5000)' })).toBeVisible()
  await expect(details.locator('ins', { hasText: 'RESTRICT' })).toBeVisible()

  await compare.click()
  await dialog.getByRole('radio', { name: /^Directly/ }).click()
  await dialog.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/diff=direct/)
  await expect(changes.getByRole('button', { name: /^comments/ })).toBeVisible()

  await page.reload()
  await expect(
    page.getByRole('region', { name: 'Tables' }).getByRole('button', { name: /^comments/ }),
  ).toBeVisible()
})
