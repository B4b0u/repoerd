// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BranchPicker } from '../../src/features/diagram/BranchPicker'
import '../../src/shared/i18n/i18n'

afterEach(cleanup)

const BRANCHES = [
  'main',
  ...Array.from({ length: 150 }, (_, i) => `feature/${String(i).padStart(3, '0')}`),
]

async function open(user: ReturnType<typeof userEvent.setup>, name: string) {
  const picker = screen.getByRole('combobox', { name })
  picker.focus()
  await user.keyboard('{Enter}')
}

describe('BranchPicker', () => {
  it('lists the first 100 matches, default and current first, and asks to refine', async () => {
    const user = userEvent.setup()
    render(
      <BranchPicker
        branches={BRANCHES}
        value="feature/149"
        defaultBranch="main"
        onChange={() => {}}
      />,
    )
    await open(user, 'Branch: feature/149')
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(100)
    expect(options.slice(0, 2).map((option) => option.textContent)).toEqual(['main', 'feature/149'])
    expect(screen.getByText('51 more branches match: refine the search.')).toBeTruthy()
    await user.type(screen.getByPlaceholderText('Search branches…'), '07')
    const found = screen.getAllByRole('option').map((option) => option.textContent)
    expect(found).toHaveLength(12)
    expect(found.slice(0, 2)).toEqual(['feature/007', 'feature/070'])
  })

  it('shows why the branches are missing and retries on demand', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <BranchPicker
        branches={undefined}
        value="main"
        onChange={() => {}}
        error="Could not load the branches: GitHub is not responding. Try again."
        onRetry={onRetry}
      />,
    )
    await open(user, 'Branch: main')
    expect(await screen.findByText(/Could not load the branches/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('says when GitHub lists more branches than RepoERD read', async () => {
    const user = userEvent.setup()
    render(<BranchPicker branches={['main']} value="main" truncated onChange={() => {}} />)
    await open(user, 'Branch: main')
    expect(
      await screen.findByText('GitHub lists more branches than RepoERD reads: some are missing.'),
    ).toBeTruthy()
  })
})
