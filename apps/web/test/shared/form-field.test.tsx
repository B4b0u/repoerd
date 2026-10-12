// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { FormField } from '../../src/shared/ui/FormField'

afterEach(() => cleanup())

it('links the hint to the control', () => {
  render(
    <FormField label="Name" hint="Shown to everyone">
      <input />
    </FormField>,
  )
  const input = screen.getByLabelText('Name')
  const hint = screen.getByText('Shown to everyone')
  expect(input.getAttribute('aria-describedby')).toBe(hint.id)
})

it('keeps the control own aria-describedby when there is no hint', () => {
  render(
    <FormField label="Name">
      <input aria-describedby="elsewhere" />
    </FormField>,
  )
  expect(screen.getByLabelText('Name').getAttribute('aria-describedby')).toBe('elsewhere')
})

it('appends the hint id to the control own aria-describedby', () => {
  render(
    <FormField label="Name" hint="Shown to everyone">
      <input aria-describedby="elsewhere" />
    </FormField>,
  )
  const input = screen.getByLabelText('Name')
  const hint = screen.getByText('Shown to everyone')
  expect(input.getAttribute('aria-describedby')).toBe(`elsewhere ${hint.id}`)
})
