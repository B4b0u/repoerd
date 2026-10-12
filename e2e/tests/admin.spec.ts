import { expect, test } from './fixtures'

// Adding a login that never signed in answers 404 user-never-signed-in on purpose.
test.use({ allowedFailedUrls: [/\/api\/admin\/admins$/] })

test('the administration page lists the demo administrator and explains a refused login', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'dev' }).click()
  await page.getByRole('menuitem', { name: 'Administration' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'Administration', level: 1 })).toBeVisible()
  await expect(page.getByText('Fake GitHub mode: no GitHub App.')).toBeVisible()

  const admins = page.getByRole('list', { name: 'Administrators' })
  await expect(admins.getByText('dev', { exact: true })).toBeVisible()
  await expect(admins.getByText('you', { exact: true })).toBeVisible()
  const users = page.getByRole('list', { name: 'Users' })
  await expect(users.getByText('administrator', { exact: true })).toBeVisible()

  await page.getByLabel('GitHub login').fill('nobody-signed-in')
  await page.getByRole('button', { name: 'Add administrator' }).click()
  await expect(page.getByText('This GitHub user has never signed in to RepoERD.')).toBeVisible()
})
