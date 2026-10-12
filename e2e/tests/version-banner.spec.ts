import { expect, test } from './fixtures'

test('a tab opened before an upgrade offers to reload', async ({ page }) => {
  // The API of a newer server: same answers, another version.
  await page.route('**/api/repos', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'x-repoerd-version': 'next' },
    })
  })
  await page.goto('/')
  const banner = page
    .getByRole('status')
    .filter({ hasText: 'A new version of RepoERD is available.' })
  await expect(banner).toBeVisible()
  await expect(banner.getByRole('button', { name: 'Reload' })).toBeVisible()
})
