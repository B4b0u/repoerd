import type { Locator, Page } from '@playwright/test'
import { expect, mainCanvas, skipGroupLayoutOffer, test } from './fixtures'

// acme/storefront: one proposed group per Prisma model file. table-groups-editing.spec.ts writes
// its groups too, only the marketing and catalog ones.

interface Point {
  x: number
  y: number
}

/** Opens the storefront once its cards are placed (the first layout is saved on the way). */
async function open(page: Page) {
  // Once the groups are saved, a later visit offers to lay the diagram out by group.
  await skipGroupLayoutOffer(page, 'acme/storefront', 'prisma/schema.prisma')
  await page.goto('/acme/storefront')
  const canvas = mainCanvas(page)
  await expect(canvas.locator('.react-flow__node[data-id="customers"]')).toBeVisible()
  return {
    canvas,
    card: (table: string) => canvas.locator(`.react-flow__node[data-id="${table}"]`),
    bar: page.getByRole('toolbar', { name: 'Selected tables' }),
  }
}

async function box(locator: Locator) {
  const found = await locator.boundingBox()
  if (!found) throw new Error('No box')
  return found
}

/** A point of the empty canvas (no card, label or overlay on top) among the given candidates. */
async function emptyPoint(page: Page, candidates: Point[]): Promise<Point> {
  const found = await page.evaluate(
    (points) =>
      points.find(({ x, y }) =>
        document.elementFromPoint(x, y)?.classList.contains('react-flow__pane'),
      ),
    candidates,
  )
  if (!found) throw new Error('No empty point of the canvas')
  return found
}

/** Candidates around a corner, going away from the cards. */
const around = (corner: Point, dx: number, dy: number): Point[] =>
  Array.from({ length: 12 }, (_, i) => ({
    x: corner.x + dx * (6 + 6 * i),
    y: corner.y + dy * (6 + 6 * i),
  }))

test('Shift+click selects cards without activating them, and the bar places them', async ({
  page,
}) => {
  const { card, bar } = await open(page)
  await page.keyboard.down('Shift')
  await card('customers').click()
  await card('products').click()
  await page.keyboard.up('Shift')

  await expect(bar.getByText('2 tables selected')).toBeVisible()
  await expect(card('customers')).toHaveClass(/\bselected\b/)
  await expect(page).not.toHaveURL(/active=/)

  const placed = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().includes('/groups-assignments'),
  )
  await bar.getByRole('button', { name: 'orders' }).click()
  const body = (await placed).postDataJSON() as { assignments: Record<string, string> }
  expect(Object.keys(body.assignments).sort()).toEqual(['customers', 'products'])
  await expect(bar).toHaveCount(0)
  await expect(page.getByText('2 tables placed in "orders".')).toBeVisible()
})

test('Shift let go before the button leaves no selection mode behind', async ({ page }) => {
  const { canvas, card, bar } = await open(page)
  // On the empty canvas, where the press starts a selection box.
  const paneBox = await box(canvas)
  const spot = await emptyPoint(
    page,
    around({ x: paneBox.x, y: paneBox.y + paneBox.height / 2 }, 1, 0),
  )
  await page.mouse.move(spot.x, spot.y)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.keyboard.up('Shift')
  await page.mouse.up()
  // On a card.
  const customers = await box(card('customers'))
  await page.mouse.move(customers.x + customers.width / 2, customers.y + customers.height / 2)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.keyboard.up('Shift')
  await page.mouse.up()

  await card('products').click()
  await expect(page).toHaveURL(/active=products/)
  await expect(card('products')).not.toHaveClass(/\bselected\b/)
  await expect(card('customers')).not.toHaveClass(/\bselected\b/)
  await expect(bar).toHaveCount(0)
})

test('a Shift+drag box selects the cards in it, which a plain click still activates', async ({
  page,
}) => {
  const { card, bar } = await open(page)
  const a = await box(card('customers'))
  const b = await box(card('addresses'))
  const left = Math.min(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  const start = await emptyPoint(page, around({ x: left, y: top }, -1, -1))
  const end = await emptyPoint(page, around({ x: right, y: bottom }, 1, 1))

  await page.mouse.move(start.x, start.y)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Shift')

  await expect(bar).toBeVisible()
  await expect(card('customers')).toHaveClass(/\bselected\b/)
  await expect(card('addresses')).toHaveClass(/\bselected\b/)
  await expect(page).not.toHaveURL(/active=/)
  // Nothing covers the selected cards: a plain click on one activates it.
  await card('addresses').click()
  await expect(page).toHaveURL(/active=addresses/)

  await page.keyboard.press('Escape')
  await expect(bar).toHaveCount(0)
})
