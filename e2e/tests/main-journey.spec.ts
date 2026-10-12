import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures'

/** The x and y of a React Flow node, read from its CSS transform. */
async function position(node: Locator): Promise<number[]> {
  const transform = await node.evaluate((element) => (element as HTMLElement).style.transform)
  return (transform.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
}

test('a moved table keeps its position after a reload', async ({ page }) => {
  await page.goto('/')
  // The first layout is computed and saved when the diagram opens.
  const initialSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/layout') &&
      response.ok(),
  )
  await page.getByRole('link', { name: /blog-drizzle/ }).click()
  await expect(page).toHaveURL(/\/acme\/blog-drizzle/)

  const posts = page.locator('.react-flow__node[data-id="posts"]')
  await expect(posts).toBeVisible()
  await initialSave
  const before = await position(posts)

  const box = await posts.boundingBox()
  if (!box) throw new Error('The posts table has no box')
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/layout') &&
      response.ok(),
  )
  await page.mouse.move(box.x + box.width / 2, box.y + 12)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 240, box.y + 132, { steps: 12 })
  await page.mouse.up()
  await saved
  const moved = await position(posts)
  expect(moved).toHaveLength(2)
  expect(moved).not.toEqual(before)

  await page.reload()
  await expect(posts).toBeVisible()
  // The saved layout stores whole pixels (DiagramCanvas rounds them); the dragged node has decimals.
  await expect.poll(() => position(posts)).toEqual(moved.map(Math.round))
})
