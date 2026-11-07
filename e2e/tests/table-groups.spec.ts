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

test('the group names stay readable on top of the overview', async ({ page }) => {
  await page.goto('/acme/helpdesk')
  const canvas = mainCanvas(page)
  const labels = canvas.locator('.group-frame__label')
  await expect(labels.filter({ hasText: 'organizations' })).toBeVisible()

  // Far below the overview threshold (0.3), where most frames are narrower than their name.
  const zoomOut = canvas.getByRole('button', { name: 'Zoom out' })
  const zoom = () =>
    canvas
      .locator('.react-flow__viewport')
      .evaluate((viewport) => new DOMMatrix(getComputedStyle(viewport).transform).a)
  for (let i = 0; i < 30 && (await zoom()) > 0.12; i++) await zoomOut.click()
  await expect(canvas).toHaveAttribute('data-overview', '')
  await expect.poll(zoom).toBeLessThanOrEqual(0.12)

  // Like the labels of a map: every name shown is whole (no ellipsis), above the cards and clear
  // of the other names; a name that would overlap a larger group's is left out at this zoom.
  const readings = await labels.evaluateAll((all) =>
    all.map((element) => {
      const box = element.getBoundingClientRect()
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return {
        name: element.textContent,
        shown: getComputedStyle(element).opacity !== '0',
        whole: element.scrollWidth <= element.clientWidth + 1,
        onTop: hit !== null && element.contains(hit),
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
      }
    }),
  )
  expect(readings).toHaveLength(6)
  const shown = readings.filter((reading) => reading.shown)
  expect(shown.length).toBeGreaterThan(1)
  for (const reading of shown) {
    expect(reading, reading.name ?? '').toMatchObject({ whole: true, onTop: true })
    // Enlarged like the table names: about 14px text on screen, not a tenth of it.
    expect(reading.box.height, reading.name ?? '').toBeGreaterThan(14)
  }
  const overlap = (a: (typeof shown)[number]['box'], b: (typeof shown)[number]['box']) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  for (const [i, a] of shown.entries()) {
    for (const b of shown.slice(i + 1))
      expect(overlap(a.box, b.box), `${a.name} ${b.name}`).toBe(false)
  }
  expect(readings.find((reading) => reading.name === 'organizations')?.onTop).toBe(true)
})

test('the table names of a far overview are readable or left out, never specks', async ({
  page,
}) => {
  await page.goto('/acme/helpdesk')
  const canvas = mainCanvas(page)
  await expect(canvas.locator('.react-flow__node').first()).toBeVisible()
  const zoomOut = canvas.getByRole('button', { name: 'Zoom out' })
  const zoom = () =>
    canvas
      .locator('.react-flow__viewport')
      .evaluate((viewport) => new DOMMatrix(getComputedStyle(viewport).transform).a)
  for (let i = 0; i < 30 && (await zoom()) > 0.08; i++) await zoomOut.click()
  await expect.poll(zoom).toBeLessThanOrEqual(0.08)

  // A card's own name is either readable on screen or hidden (its name then floats, or not).
  await expect
    .poll(() =>
      canvas.locator('.table-node__overview-name').evaluateAll(
        (names) =>
          names.filter((name) => {
            const size = Number.parseFloat(getComputedStyle(name).fontSize)
            const screen =
              size *
              new DOMMatrix(
                getComputedStyle(name.closest('.react-flow__viewport') as Element).transform,
              ).a
            return size > 0 && screen < 9
          }).length,
      ),
    )
    .toBe(0)

  const floating = canvas.locator('.overview-label')
  await expect(floating.first()).toBeVisible()
  const boxes = await canvas.locator('.overview-label, .group-frame__label').evaluateAll((all) =>
    all
      .filter((element) => getComputedStyle(element).opacity !== '0')
      .map((element) => {
        const box = element.getBoundingClientRect()
        return {
          name: element.textContent,
          whole: element.scrollWidth <= element.clientWidth + 1,
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
        }
      }),
  )
  type Box = (typeof boxes)[number]['box']
  const overlap = (a: Box, b: Box) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  for (const [i, a] of boxes.entries()) {
    expect(a.whole, a.name ?? '').toBe(true)
    for (const b of boxes.slice(i + 1))
      expect(overlap(a.box, b.box), `${a.name} ${b.name}`).toBe(false)
  }
})
