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

  // Every name whole (no ellipsis) and above the cards: under its centre is a group label (the
  // frames of this schema overlap, so a label may cover another one, never a card).
  const readings = await labels.evaluateAll((all) =>
    all.map((element) => {
      const box = element.getBoundingClientRect()
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return {
        name: element.textContent,
        whole: element.scrollWidth <= element.clientWidth + 1,
        onTop: hit !== null && element.contains(hit),
        aboveCards: hit?.closest('.group-frame__label') != null,
        height: box.height,
      }
    }),
  )
  expect(readings).toHaveLength(6)
  for (const reading of readings) {
    expect(reading, reading.name ?? '').toMatchObject({ whole: true, aboveCards: true })
    // Enlarged like the table names: about 14px text on screen, not a tenth of it.
    expect(reading.height, reading.name ?? '').toBeGreaterThan(14)
  }
  expect(readings.find((reading) => reading.name === 'organizations')?.onTop).toBe(true)
})
