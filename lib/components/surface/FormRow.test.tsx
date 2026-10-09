/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { FormRow, formRowHintId } from './FormRow'

describe('FormRow', () => {
  it('ties the label to the control', () => {
    render(
      <FormRow label="Display name" htmlFor="name">
        <input id="name" />
      </FormRow>
    )
    expect(
      screen.getByRole('textbox', { name: 'Display name' })
    ).toBeInTheDocument()
  })

  it('gives the render prop the hint id for aria-describedby', () => {
    render(
      <FormRow label="Display name" htmlFor="name" hint="Shown on your profile">
        {({ describedBy }) => (
          <input id="name" aria-describedby={describedBy} />
        )}
      </FormRow>
    )
    const input = screen.getByRole('textbox', { name: 'Display name' })
    expect(input).toHaveAccessibleDescription('Shown on your profile')
    expect(input).toHaveAttribute('aria-describedby', formRowHintId('name'))
  })

  it('passes no describedBy without a hint', () => {
    render(
      <FormRow label="Display name" htmlFor="name">
        {({ describedBy }) => (
          <input id="name" aria-describedby={describedBy} />
        )}
      </FormRow>
    )
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby')
  })

  it('stacks on a phone and splits into two columns from sm', () => {
    render(
      <FormRow label="Name" htmlFor="name">
        <input id="name" />
      </FormRow>
    )
    const row = screen.getByRole('textbox').closest('[data-slot="form-row"]')
    expect(row).toHaveClass('flex-col', 'sm:grid')
    expect(row?.className).toMatch(
      /sm:grid-cols-\[minmax\(0,1fr\)_minmax\(0,20rem\)\]/
    )
  })

  it('gives a wide control the rest of the row', () => {
    render(
      <FormRow label="Bio" htmlFor="bio" wide>
        <textarea id="bio" />
      </FormRow>
    )
    const row = screen.getByRole('textbox').closest('[data-slot="form-row"]')
    expect(row?.className).toMatch(
      /sm:grid-cols-\[minmax\(0,16rem\)_minmax\(0,1fr\)\]/
    )
  })

  it('keeps an inline control on the label row on a phone', () => {
    render(
      <FormRow label="Notify me" htmlFor="notify" inline>
        <input id="notify" type="checkbox" />
      </FormRow>
    )
    const row = screen
      .getByRole('checkbox')
      .closest('[data-slot="form-row"]') as HTMLElement
    expect(row).toHaveClass('flex', 'items-center', 'justify-between')
    expect(row).not.toHaveClass('flex-col')
  })
})
