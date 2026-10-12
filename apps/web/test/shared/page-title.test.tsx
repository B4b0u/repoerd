// @vitest-environment jsdom
import { cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useHeadingFocus, usePageTitle } from '../../src/shared/lib/page-title'

afterEach(cleanup)

describe('usePageTitle', () => {
  it('names the page in the tab, after its own title', () => {
    const { rerender } = renderHook(({ title }) => usePageTitle(title), {
      initialProps: { title: 'Repositories' as string | undefined },
    })
    expect(document.title).toBe('Repositories · RepoERD')
    rerender({ title: undefined })
    expect(document.title).toBe('RepoERD')
  })
})

describe('useHeadingFocus', () => {
  function Page() {
    const heading = useHeadingFocus<HTMLHeadingElement>()
    return (
      <h1 ref={heading} tabIndex={-1}>
        Title
      </h1>
    )
  }

  it('moves the focus to the heading of a page that appears', () => {
    const { getByRole } = render(<Page />)
    expect(document.activeElement).toBe(getByRole('heading', { name: 'Title' }))
  })
})
