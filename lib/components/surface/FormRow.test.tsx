/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { FormRow, formRowHintId, formRowLabelId } from './FormRow'

describe('FormRow', () => {
  // The hairline between rows belongs to the `Frame form` around them, so rows
  // stacked anywhere else (an auth card, a dialog grid) draw no rule.
  it('pads its row px-4 py-2.5 and draws no rule of its own', () => {
    const { container } = render(
      <>
        <FormRow label="First" htmlFor="first">
          <input id="first" />
        </FormRow>
        <FormRow label="Second" htmlFor="second">
          <input id="second" />
        </FormRow>
      </>
    )
    const rows = container.querySelectorAll('[data-slot="form-row"]')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row).toHaveClass('px-4', 'py-2.5')
      expect(row.className).not.toMatch(/border-t/)
    }
  })

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

  it('exposes the label id so a group can use aria-labelledby', () => {
    render(
      <FormRow label="Shade by" htmlFor="shade">
        {({ labelledBy }) => (
          <div role="radiogroup" aria-labelledby={labelledBy}>
            <input type="radio" aria-label="Count" />
          </div>
        )}
      </FormRow>
    )
    const group = screen.getByRole('radiogroup', { name: 'Shade by' })
    expect(group).toHaveAttribute('aria-labelledby', formRowLabelId('shade'))
    expect(document.getElementById(formRowLabelId('shade'))).toHaveTextContent(
      'Shade by'
    )
  })

  it('still gives a label id when there is no htmlFor', () => {
    render(
      <FormRow label="Shade by">
        {({ labelledBy }) => (
          <div role="radiogroup" aria-labelledby={labelledBy} />
        )}
      </FormRow>
    )
    expect(
      screen.getByRole('radiogroup', { name: 'Shade by' })
    ).toBeInTheDocument()
  })

  it('names a stacked control by its label and describes it by its hint', () => {
    render(
      <FormRow stacked label="Email" htmlFor="email" hint="We never share it">
        {({ describedBy }) => (
          <input id="email" aria-describedby={describedBy} />
        )}
      </FormRow>
    )

    const input = screen.getByRole('textbox', { name: 'Email' })
    expect(input).toHaveAccessibleDescription('We never share it')
  })
})
