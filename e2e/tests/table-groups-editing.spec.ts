import type { Page } from '@playwright/test'
import { expect, mainCanvas, test } from './fixtures'

// acme/storefront, whose groups table-groups-selection.spec.ts writes too (the tests share one
// database, in either order): these tests only touch the marketing and catalog groups, and save
// the proposals only if no other test saved them first.

/**
 * Opens the storefront, its proposals saved for the team. Resolves with the URL of the layout it
 * reads, once that layout holds positions (the first visit saves the ones it lays out).
 */
async function openWithSavedGroups(page: Page) {
  const layoutRead = page.waitForResponse(
    (r) => r.request().method() === 'GET' && r.url().includes('/layout?'),
  )
  await page.goto('/acme/storefront')
  const canvas = mainCanvas(page)
  await expect(canvas.locator('.group-frame__label').first()).toBeVisible()
  const save = page.getByRole('button', { name: 'Save for the team' })
  if (await save.isVisible()) {
    await save.click()
    await expect(save).toHaveCount(0)
  }
  const layoutUrl = (await layoutRead).url()
  await expect
    .poll(async () => {
      const layout = (await (await page.request.get(layoutUrl)).json()) as Layout
      return layout.positions.length
    })
    .toBeGreaterThan(0)
  return { canvas, layoutUrl }
}

interface Layout {
  positions: { table: string; x: number; y: number }[]
}

const groupWrites = (page: Page) => {
  const sent: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /\/groups(-assignments)?[/?]/.test(request.url())) {
      sent.push(`${request.method()} ${request.postData() ?? ''}`)
    }
  })
  return sent
}

test('renames a group, places a table in it from its details and undoes it, for good', async ({
  page,
}) => {
  const { canvas } = await openWithSavedGroups(page)

  // Rename from the frame label.
  await canvas.getByRole('button', { name: 'Edit the group marketing' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit the group marketing' })
  await editor.getByLabel('Name').fill('Promotions')
  await editor.getByRole('button', { name: 'Rename' }).click()
  await expect(canvas.getByRole('button', { name: 'Edit the group Promotions' })).toBeVisible()

  // The native colour picker inside the editor: the editor stays open while it is used, and the
  // colour is saved once, when the picker reports its final value.
  await canvas.getByRole('button', { name: 'Edit the group Promotions' }).click()
  const promotions = page.getByRole('dialog', { name: 'Edit the group Promotions' })
  const sent = groupWrites(page)
  const picker = promotions.getByLabel('Custom color')
  await picker.click()
  await expect(promotions).toBeVisible()
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes('/groups/') && r.ok(),
  )
  await picker.fill('#2f6b3a')
  await saved
  await expect(promotions).toBeVisible()
  expect(sent).toHaveLength(1)
  expect(sent[0]).toContain('"color":"#2f6b3a"')
  await page.keyboard.press('Escape')
  await expect(promotions).toHaveCount(0)

  // Place a catalog table in the group from its details, then undo.
  await canvas.locator('.react-flow__node[data-id="brands"]').click()
  await expect(page).toHaveURL(/active=brands/)
  const detail = page.getByRole('complementary', { name: 'Details of brands' })
  const group = detail.getByRole('combobox', { name: 'Group' })
  await expect(group).toHaveText('catalog')
  await group.click()
  await page.getByRole('option', { name: 'Promotions' }).click()
  await expect(group).toHaveText('Promotions')
  const notice = page.getByRole('listitem').filter({ hasText: '1 table placed in "Promotions".' })
  await notice.getByRole('button', { name: 'Undo' }).click()
  await expect(group).toHaveText('catalog')

  // Saved for everyone: a reload shows the same groups.
  await page.reload()
  await expect(canvas.getByRole('button', { name: 'Edit the group Promotions' })).toBeVisible()
  await expect(canvas.getByRole('button', { name: 'Edit the group marketing' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save for the team' })).toHaveCount(0)
  await expect(detail.getByRole('combobox', { name: 'Group' })).toHaveText('catalog')
})

test('offers once to lay out a diagram arranged before its groups were saved', async ({ page }) => {
  const { canvas, layoutUrl } = await openWithSavedGroups(page)
  const offer = page.getByRole('button', { name: 'Lay out my diagram by group' })
  // The frames that overlap, by index (the frames follow the measured cards).
  const overlaps = () =>
    canvas.locator('.group-frame').evaluateAll((all) => {
      const boxes = all.map((frame) => frame.getBoundingClientRect())
      const pairs: number[][] = []
      for (const [i, a] of boxes.entries()) {
        for (const [j, b] of boxes.entries()) {
          const overlap =
            j > i && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
          if (overlap) pairs.push([i, j])
        }
      }
      return { frames: boxes.length, pairs }
    })
  // The user had arranged the diagram their own way: a grid in alphabetical order, which
  // mixes the groups.
  const saved = (await (await page.request.get(layoutUrl)).json()) as Layout
  const tables = saved.positions.map((p) => p.table).sort()
  const moved = await page.request.patch(layoutUrl, {
    headers: { 'x-repoerd-request': '1' },
    data: {
      positions: tables.map((table, i) => ({
        table,
        x: (i % 5) * 400,
        y: Math.floor(i / 5) * 400,
      })),
    },
  })
  expect(moved.ok()).toBe(true)

  // A later visit: the layout was saved before it (unit tests cover a first visit).
  await page.reload()
  await expect(canvas.locator('.react-flow__node').first()).toBeVisible()
  await expect.poll(async () => (await overlaps()).pairs.length).toBeGreaterThan(0)
  const laidOut = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes('/layout?') && r.ok(),
  )
  await offer.click()
  await page
    .getByRole('alertdialog', { name: 'Rearrange all tables?' })
    .getByRole('button', {
      name: 'Rearrange',
    })
    .click()
  await laidOut

  // Laid out group by group: no frame overlaps another.
  await expect.poll(overlaps).toEqual({ frames: 5, pairs: [] })

  // Once per browser: not offered again.
  await page.reload()
  await expect(canvas.locator('.react-flow__node').first()).toBeVisible()
  await expect(canvas.locator('.group-frame__label').first()).toBeVisible()
  await expect(offer).toHaveCount(0)
})

test('dragging a group label moves its tables, saved; a click still opens the editor', async ({
  page,
}) => {
  const { canvas, layoutUrl } = await openWithSavedGroups(page)
  const label = canvas.locator('.group-frame__label', { hasText: 'catalog' })
  await expect(label).toBeVisible()
  const groupId = await label.getAttribute('data-label-of')
  const frame = canvas.locator(`.group-frame[data-group-id="${groupId}"]`)
  const members = await canvas.locator('.react-flow__node').evaluateAll(
    (nodes, frameBox) => {
      const f = frameBox as DOMRect
      return nodes
        .filter((node) => {
          const b = node.getBoundingClientRect()
          return b.left >= f.left && b.right <= f.right && b.top >= f.top && b.bottom <= f.bottom
        })
        .map((node) => node.getAttribute('data-id') as string)
    },
    await frame.evaluate((element) => element.getBoundingClientRect().toJSON()),
  )
  expect(members.length).toBeGreaterThan(0)
  const before = (await (await page.request.get(layoutUrl)).json()) as Layout
  const startOf = (layout: Layout, table: string) =>
    layout.positions.find((position) => position.table === table)

  const box = await label.boundingBox()
  if (!box) throw new Error('no label')
  const zoom = await canvas
    .locator('.react-flow__viewport')
    .evaluate((viewport) => new DOMMatrix(getComputedStyle(viewport).transform).a)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 })
  await page.mouse.up()

  // Moved, not opened: the tables of the frame, and only them, are saved at their new place.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect
    .poll(async () => {
      const after = (await (await page.request.get(layoutUrl)).json()) as Layout
      const moved = after.positions.filter((b) => {
        const a = startOf(before, b.table)
        return a !== undefined && (a.x !== b.x || a.y !== b.y)
      })
      const shifted = moved.every((b) => {
        const a = startOf(before, b.table) as Layout['positions'][number]
        return Math.abs(b.x - a.x - 120 / zoom) <= 2 && Math.abs(b.y - a.y - 60 / zoom) <= 2
      })
      return { moved: moved.map((b) => b.table).sort(), shifted }
    })
    .toEqual({ moved: [...members].sort(), shifted: true })

  // A plain click on the label still opens the group's editor.
  await label.click()
  await expect(page.getByRole('dialog', { name: /Edit the group catalog/ })).toBeVisible()
  await page.keyboard.press('Escape')
})
