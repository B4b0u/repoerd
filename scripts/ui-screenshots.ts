/**
 * Screenshots against a running fake-mode stack (default http://localhost:5180).
 * - Every screen in English and French, dark and light (default target):
 *     SCREENS_LABEL=after pnpm exec tsx scripts/ui-screenshots.ts
 *   Images land in apps/web/.screenshots/<label>/<lang>-<theme>-<screen>.png (git-ignored).
 * - The images of the README, in English (docs/images/):
 *     SCREENS_TARGET=readme SCREENS_BASE_URL=http://localhost:3300 pnpm exec tsx scripts/ui-screenshots.ts
 *   against a production server in fake mode with a fresh database (automatic layouts): the
 *   script saves the proposed table groups for the team, stars and opens repositories first.
 */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { type Browser, type BrowserContextOptions, chromium, type Page } from 'playwright'

const BASE_URL = process.env.SCREENS_BASE_URL ?? 'http://localhost:5180'
const TARGET = process.env.SCREENS_TARGET ?? 'screens'
const LABEL = process.env.SCREENS_LABEL ?? 'latest'
const OUT_DIR = new URL(`../apps/web/.screenshots/${LABEL}/`, import.meta.url)
const README_DIR = new URL('../docs/images/', import.meta.url)
const VIEWPORT = { width: 1440, height: 900 }

const SIGNED_OUT_STATUS = {
  mode: 'real',
  state: 'ready',
  unlocked: false,
  publicUrl: 'https://erd.example.com',
  app: null,
}

/** Real-mode screens a fake-mode stack cannot show: their API answers are mocked. */
async function mockSignedOut(page: Page) {
  await page.route('**/api/setup/status', (route) => route.fulfill({ json: SIGNED_OUT_STATUS }))
  await page.route('**/api/me', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'unauthenticated', message: 'Sign in required' } },
    }),
  )
}

function mockSetup(status: Record<string, unknown>) {
  return (page: Page) =>
    page.route('**/api/setup/status', (route) =>
      route.fulfill({ json: { mode: 'real', publicUrl: null, app: null, ...status } }),
    )
}

interface Screen {
  name: string
  path: string
  mock?: (page: Page) => Promise<void>
  /** Opens a menu or a popover before the capture; skipped when the control does not exist yet. */
  act?: (page: Page) => Promise<void>
}

const SCREENS: Screen[] = [
  { name: 'repos', path: '/' },
  {
    name: 'repos-user-menu',
    path: '/',
    act: (page) => page.getByRole('button', { name: 'dev' }).click({ timeout: 3000 }),
  },
  { name: 'diagram', path: '/acme/shop-prisma' },
  {
    name: 'diagram-branches',
    path: '/acme/shop-prisma',
    act: (page) => page.getByRole('combobox', { name: /branch|branche/i }).click({ timeout: 3000 }),
  },
  {
    // An AlertDialog renders in a portal: light and dark must reach it too.
    name: 'diagram-rearrange-dialog',
    path: '/acme/shop-prisma',
    act: (page) =>
      page
        .getByRole('button', { name: /Rearrange all tables|Réorganiser toutes les tables/ })
        .click({ timeout: 3000 }),
  },
  { name: 'diagram-detail', path: '/acme/shop-prisma?active=users' },
  { name: 'diagram-related', path: '/acme/shop-prisma?focus=users&active=users' },
  { name: 'diagram-keys-only', path: '/acme/platform-monorepo?mode=KEYS_ONLY' },
  {
    name: 'diagram-compare',
    path: '/acme/blog-drizzle?branch=feature%2Fpost-tags&compare=main',
  },
  {
    name: 'diagram-compare-detail',
    path: '/acme/blog-drizzle?branch=feature%2Fpost-tags&compare=main&active=posts',
  },
  {
    name: 'diagram-compare-control',
    path: '/acme/blog-drizzle?branch=feature%2Fpost-tags',
    act: (page) =>
      page.getByRole('button', { name: /^(Compare|Comparer)$/ }).click({ timeout: 3000 }),
  },
  { name: 'diagram-no-schema', path: '/acme/no-schema' },
  { name: 'diagram-parse-error', path: '/acme/broken-prisma' },
  { name: 'settings', path: '/acme/shop-prisma/settings' },
  { name: 'admin', path: '/admin' },
  { name: 'sign-in', path: '/', mock: mockSignedOut },
  { name: 'sign-in-error', path: '/signin?error=org-not-allowed', mock: mockSignedOut },
  { name: 'setup-code', path: '/setup', mock: mockSetup({ state: 'needs-app', unlocked: false }) },
  { name: 'setup-app', path: '/setup', mock: mockSetup({ state: 'needs-app', unlocked: true }) },
  {
    name: 'setup-admin',
    path: '/setup',
    mock: mockSetup({
      state: 'needs-admin',
      unlocked: true,
      app: {
        name: 'RepoERD erd',
        htmlUrl: 'https://github.com/apps/x',
        installUrl: 'https://github.com/apps/x/installations/new',
      },
    }),
  },
  { name: 'not-found', path: '/a/b/c/d' },
]

interface ReadmeShot {
  file: string
  path: string
  theme: 'dark' | 'light'
  /** Rearrange all tables first: the comparison adds tables to a layout saved on `main`, and they can overlap. */
  rearrange?: boolean
  /** Centres the frames of these groups and zooms in on them: the whole schema fits only at a zoom where nothing reads. */
  focus?: { groups: string[]; zoom: number }
}

/** The README images (spec §7.2) of the acme/storefront showcase; the repository page comes last. */
const README_SHOTS: ReadmeShot[] = [
  {
    file: 'storefront-dark.png',
    path: '/acme/storefront',
    theme: 'dark',
    focus: { groups: ['orders', 'marketing'], zoom: 0.45 },
  },
  {
    file: 'storefront-light.png',
    path: '/acme/storefront',
    theme: 'light',
    focus: { groups: ['orders', 'marketing'], zoom: 0.45 },
  },
  { file: 'table-detail.png', path: '/acme/storefront?active=orders', theme: 'dark' },
  {
    file: 'related-tables.png',
    path: '/acme/storefront?focus=orders&active=orders',
    theme: 'light',
  },
  {
    file: 'compare-changes.png',
    path: '/acme/storefront?branch=feature%2Fsubscriptions&compare=main',
    theme: 'dark',
    rearrange: true,
  },
  {
    file: 'compare-detail.png',
    path: '/acme/storefront?branch=feature%2Fsubscriptions&compare=main&active=orders&mode=KEYS_ONLY',
    theme: 'dark',
    rearrange: true,
  },
]

async function newContext(
  browser: Browser,
  lang: 'en' | 'fr',
  theme: 'dark' | 'light',
  deviceScaleFactor = 1,
  storageState?: BrowserContextOptions['storageState'],
) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor,
    locale: lang === 'fr' ? 'fr-FR' : 'en-US',
    storageState,
  })
  await context.addInitScript(
    (choice) => {
      localStorage.setItem('repoerd:lang', choice.lang)
      localStorage.setItem('repoerd:theme', choice.theme)
    },
    { lang, theme },
  )
  return context
}

async function captureScreens(browser: Browser) {
  await mkdir(OUT_DIR, { recursive: true })
  for (const lang of ['en', 'fr'] as const) {
    for (const theme of ['dark', 'light'] as const) {
      const context = await newContext(browser, lang, theme)
      for (const screen of SCREENS) {
        const page = await context.newPage()
        await screen.mock?.(page)
        await page.goto(new URL(screen.path, BASE_URL).href, { waitUntil: 'networkidle' })
        await page.waitForTimeout(800)
        if (screen.act) {
          try {
            await screen.act(page)
            await page.waitForTimeout(400)
          } catch {
            console.warn(`${screen.name}: action skipped (control not found)`)
          }
        }
        await page.screenshot({
          path: fileURLToPath(new URL(`${lang}-${theme}-${screen.name}.png`, OUT_DIR)),
        })
        await page.close()
      }
      await context.close()
    }
  }
}

/** Starred and opened before the captures: the repository page shows its favourites and recents. */
const FAVORITES = ['acme/storefront', 'acme/blog-drizzle']
const OPENED = ['acme/crm', 'acme/blog-drizzle']

/**
 * The state the README shows: the storefront's proposed groups saved for the team (its first
 * visit already laid the tables out by these groups), favourites, and repositories opened lately.
 * Returns the browser storage the captures start from: another browser would be offered to lay
 * the diagram out by group, which it already is.
 */
async function prepareReadme(browser: Browser) {
  const context = await newContext(browser, 'en', 'dark')
  const page = await context.newPage()
  const open = (path: string) =>
    page.goto(new URL(path, BASE_URL).href, { waitUntil: 'networkidle' })
  await open('/acme/storefront')
  // Let the first layout be placed and saved.
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Save for the team' }).click()
  await page.getByRole('button', { name: 'Save for the team' }).waitFor({ state: 'detached' })
  for (const repo of OPENED) {
    await open(`/${repo}`)
    await page.waitForTimeout(1500)
  }
  await open('/')
  for (const repo of FAVORITES) {
    await page
      .getByRole('button', { name: `Add ${repo} to favourites` })
      .first()
      .click()
    await page.waitForTimeout(300)
  }
  const storage = await context.storageState()
  await context.close()
  return storage
}

/** Pans the frames of the groups to the middle of the canvas, then zooms in around them. */
async function focusGroups(page: Page, groups: string[], zoom: number) {
  const pane = await page.locator('.react-flow').boundingBox()
  const frames = await Promise.all(
    groups.map(async (group) => {
      const id = await page
        .locator('[data-label-of]', { hasText: new RegExp(`^${group}$`) })
        .getAttribute('data-label-of')
      const frame = await page.locator(`.group-frame[data-group-id="${id}"]`).boundingBox()
      if (!frame) throw new Error(`No frame for the group ${group}`)
      return frame
    }),
  )
  if (!pane) throw new Error('No canvas')
  const left = Math.min(...frames.map((frame) => frame.x))
  const right = Math.max(...frames.map((frame) => frame.x + frame.width))
  const top = Math.min(...frames.map((frame) => frame.y))
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height))
  const middle = { x: pane.x + pane.width / 2, y: pane.y + pane.height / 2 }
  // An empty corner of the fitted view: dragging it pans without moving a table.
  const grip = { x: pane.x + 60, y: pane.y + 60 }
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(
    grip.x + middle.x - (left + right) / 2,
    grip.y + middle.y - (top + bottom) / 2,
    { steps: 10 },
  )
  await page.mouse.up()
  // The wheel zooms around the pointer: the frames stay in the middle.
  await page.mouse.move(middle.x, middle.y)
  const zoomText = page
    .getByRole('button', { name: 'Zoom in' })
    .locator('xpath=preceding-sibling::span[1]')
  while (Number.parseInt((await zoomText.textContent()) ?? '0', 10) / 100 < zoom) {
    await page.mouse.wheel(0, -40)
    await page.waitForTimeout(50)
  }
  // A hovered table highlights its links and dims the others: leave the pointer on the header.
  await page.mouse.move(middle.x, 20)
  await page.waitForTimeout(500)
}

async function captureReadme(browser: Browser) {
  await mkdir(README_DIR, { recursive: true })
  const storage = await prepareReadme(browser)
  for (const shot of README_SHOTS) {
    const context = await newContext(browser, 'en', shot.theme, 2, storage)
    const page = await context.newPage()
    await page.goto(new URL(shot.path, BASE_URL).href, { waitUntil: 'networkidle' })
    // The first visit places the tables (ELK) and saves the layout: let it settle.
    await page.waitForTimeout(1500)
    if (shot.rearrange) {
      await page.getByRole('button', { name: 'Rearrange all tables' }).click()
      await page.getByRole('button', { name: 'Rearrange', exact: true }).click()
      await page.waitForTimeout(2000)
    }
    if (shot.focus) await focusGroups(page, shot.focus.groups, shot.focus.zoom)
    await page.screenshot({ path: fileURLToPath(new URL(shot.file, README_DIR)) })
    console.log(`docs/images/${shot.file}`)
    await context.close()
  }
  await captureRepositories(browser)
}

/** The repository page, once the format of every repository is detected. */
async function captureRepositories(browser: Browser) {
  const context = await newContext(browser, 'en', 'dark', 2)
  const page = await context.newPage()
  await page.goto(new URL('/', BASE_URL).href, { waitUntil: 'networkidle' })
  await page
    .getByText('Detecting the schema…')
    .first()
    .waitFor({ state: 'detached', timeout: 60_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: fileURLToPath(new URL('repositories.png', README_DIR)) })
  console.log('docs/images/repositories.png')
  await context.close()
}

const browser = await chromium.launch()
try {
  if (TARGET === 'readme') await captureReadme(browser)
  else await captureScreens(browser)
} finally {
  await browser.close()
}
