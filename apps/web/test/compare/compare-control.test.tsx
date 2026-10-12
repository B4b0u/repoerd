// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompareControl } from '../../src/features/compare/CompareControl'

afterEach(cleanup)

describe('CompareControl', () => {
  it('offers every branch but the displayed one, and applies the chosen mode', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(
      <CompareControl
        branches={['main', 'feature/x', 'dev']}
        head="feature/x"
        defaultBranch="main"
        base={undefined}
        mode="merge-base"
        onApply={onApply}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Compare' }))
    const dialog = within(screen.getByRole('dialog'))
    const reference = dialog.getByRole('combobox', { name: 'Reference branch (before)' })
    expect(reference.textContent).toContain('main')

    await user.click(reference)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['main', 'dev'])
    await user.click(screen.getByRole('option', { name: 'dev' }))
    await user.click(dialog.getByRole('radio', { name: /^Directly/ }))
    await user.click(dialog.getByRole('button', { name: 'Compare' }))
    expect(onApply).toHaveBeenCalledWith('dev', 'direct')
  })
})
