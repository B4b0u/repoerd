import { expect, mainCanvas, test } from './fixtures'

test('the helpdesk schema files open as proposed groups that the list can hide', async ({
  page,
}) => {
  await page.goto('/acme/helpdesk')
  await expect(page.getByRole('status').filter({ hasText: 'groups proposed' })).toBeVisible()
  const canvas = mainCanvas(page)
  await expect(canvas.locator('.group-frame__label', { hasText: 'tickets' })).toBeVisible()

  const list = page.getByRole('complementary', { name: 'Tables' })
  await expect(list.getByRole('region', { name: 'tickets' })).toBeVisible()
  await list.getByRole('checkbox', { name: 'Show the group tickets' }).click()

  await expect(page).toHaveURL(/hidden=tickets/)
  await expect(page).toHaveURL(/hidden=messages/)
  await expect(canvas.locator('.react-flow__node[data-id="tickets"]')).toHaveCount(0)
  await expect(canvas.locator('.group-frame__label', { hasText: 'tickets' })).toHaveCount(0)
})
