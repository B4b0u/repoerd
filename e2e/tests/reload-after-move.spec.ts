import type { Locator } from '@playwright/test'
import { expect, mainCanvas, test } from './fixtures'

/** The x and y of a React Flow node, read from its CSS transform. */
async function position(node: Locator): Promise<number[]> {
  const transform = await node.evaluate((element) => (element as HTMLElement).style.transform)
  return (transform.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
}

test('a table moved just before a reload keeps its position', async ({ page }) => {
  const initialSave = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes('/layout') && r.ok(),
  )
  await page.goto('/acme/multi-source')
  const node = mainCanvas(page).locator('.react-flow__node').first()
  await expect(node).toBeVisible()
  await initialSave // the first layout of this repository is saved when it opens
  const id = await node.getAttribute('data-id')
  const box = await node.boundingBox()
  if (!id || !box) throw new Error('No table to move')
  await page.mouse.move(box.x + box.width / 2, box.y + 12)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + 112, { steps: 10 })
  await page.mouse.up()
  const moved = await position(node)
  await page.reload() // immediately: the 500 ms batch has not fired
  const again = mainCanvas(page).locator(`.react-flow__node[data-id="${id}"]`)
  // Stored positions are whole pixels; the dragged node has decimals.
  await expect.poll(() => position(again)).toEqual(moved.map(Math.round))
})
