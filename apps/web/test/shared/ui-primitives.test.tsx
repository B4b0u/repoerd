// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Checkbox } from '../../src/shared/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../src/shared/ui/select'

afterEach(() => cleanup())

function FruitPicker() {
  const [fruit, setFruit] = useState('apple')
  return (
    <>
      <Select value={fruit} onValueChange={setFruit}>
        <SelectTrigger aria-label="Fruit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="pear">Pear</SelectItem>
        </SelectContent>
      </Select>
      <output>{fruit}</output>
    </>
  )
}

describe('shadcn/ui primitives in jsdom', () => {
  it('picks a Select option with the pointer', async () => {
    const user = userEvent.setup()
    render(<FruitPicker />)
    await user.click(screen.getByRole('combobox', { name: 'Fruit' }))
    await user.click(await screen.findByRole('option', { name: 'Pear' }))
    expect(screen.getByRole('status').textContent).toBe('pear')
  })

  it('toggles a Checkbox', async () => {
    const user = userEvent.setup()
    render(<Checkbox aria-label="Show users" defaultChecked />)
    const box = screen.getByRole('checkbox', { name: 'Show users' })
    expect(box.getAttribute('aria-checked')).toBe('true')
    await user.click(box)
    expect(box.getAttribute('aria-checked')).toBe('false')
  })
})
