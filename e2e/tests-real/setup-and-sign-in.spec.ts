import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { FAKE_APP, FAKE_REPO, FAKE_USER } from '../real-mode/fake-github'
import { SETUP_CODE_FILE } from '../real-mode/files'
import { expect, test } from '../tests/fixtures'

/** Written by real-mode/start-stack.ts from the server logs. */
function setupCode(): string {
  try {
    return readFileSync(
      path.join(process.env.REPOERD_E2E_DATA ?? '', SETUP_CODE_FILE),
      'utf8',
    ).trim()
  } catch {
    return ''
  }
}

test('the setup registers an existing App and its first sign-in becomes the administrator', async ({
  page,
  baseURL,
}) => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })

  await page.goto('/')
  await expect(page).toHaveURL(/\/setup$/)
  await expect.poll(setupCode).toMatch(/\S/)
  await page.getByLabel('Setup code').fill(setupCode())
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByText('Connect a GitHub App', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Public URL of RepoERD')).toHaveValue(baseURL ?? '')
  await page.getByRole('radio', { name: 'Use an existing App' }).click()
  await page.getByLabel('App ID').fill(String(FAKE_APP.id))
  await page.getByLabel('Client ID').fill(FAKE_APP.clientId)
  await page.getByLabel('Client secret').fill(FAKE_APP.clientSecret)
  await page.getByLabel('Private key (.pem)').fill(privateKey)
  await page.getByRole('button', { name: 'Save the App' }).click()

  // Sign-in goes through the fake GitHub and back to /setup with a session.
  await expect(page.getByText('Become the administrator', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Sign in with GitHub' }).click()
  await expect(page.getByText('RepoERD is ready', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Open the repositories' }).click()
  await expect(page.getByRole('link', { name: new RegExp(FAKE_REPO.name) })).toBeVisible()

  await page.getByRole('button', { name: FAKE_USER.login }).click()
  await page.getByRole('menuitem', { name: 'Administration' }).click()
  await expect(page.getByRole('heading', { name: 'Administration', level: 1 })).toBeVisible()
  await expect(page.getByText(FAKE_APP.name, { exact: true })).toBeVisible()
  const admins = page.getByRole('list', { name: 'Administrators' })
  await expect(admins.getByText(FAKE_USER.login, { exact: true })).toBeVisible()
})
