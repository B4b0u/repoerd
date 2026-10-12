// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SchemaNotices } from '../../src/features/diagram/SchemaNotices'
import { renderWithApp } from '../render'

afterEach(() => cleanup())

describe('SchemaNotices', () => {
  it('tells how many views are not drawn, in the status bar', () => {
    renderWithApp(<SchemaNotices treeTruncated={false} ignoredViews={2} />)
    const notice = screen.getByText('2 views are not shown: RepoERD draws tables only.')
    expect(notice.closest('[role="status"]')).not.toBeNull()
  })

  it('uses the singular for one view and keeps the truncated-tree warning', () => {
    renderWithApp(<SchemaNotices treeTruncated ignoredViews={1} />)
    const notice = screen.getByText('1 view is not shown: RepoERD draws tables only.')
    expect(notice.closest('[role="status"]')?.textContent).toContain('too large for the GitHub API')
  })

  it('shows nothing when nothing is left out', () => {
    const { container } = renderWithApp(<SchemaNotices treeTruncated={false} ignoredViews={0} />)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})
