/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { AddBar } from './AddBar'

describe('AddBar', () => {
  it('labels the input and puts the Add button on the same form', () => {
    render(<AddBar label="New rule" buttonLabel="Add rule" />)
    const input = screen.getByLabelText('New rule')
    const button = screen.getByRole('button', { name: 'Add rule' })
    expect(input.closest('form')).toBe(button.closest('form'))
  })

  it('submits through the form, so Enter in the field works', () => {
    const onSubmit = vi.fn((event) => event.preventDefault())
    render(<AddBar label="Domain" onSubmit={onSubmit} />)
    fireEvent.submit(screen.getByLabelText('Domain'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('shows a prefix, a hint and an error in the box and describes the input by them', () => {
    render(
      <AddBar
        label="Add a hashtag"
        prefix="#"
        hint="Letters and numbers."
        error="Already featured."
      />
    )
    const input = screen.getByLabelText('Add a hashtag')
    expect(screen.getByRole('alert')).toHaveTextContent('Already featured.')
    expect(input).toHaveAccessibleDescription(
      'Letters and numbers. Already featured.'
    )
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('#')).toBeInTheDocument()
  })

  it('disables the button without disabling the field', () => {
    render(<AddBar label="Domain" buttonDisabled />)
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    expect(screen.getByLabelText('Domain')).toBeEnabled()
  })

  it('renders a dropdown and extra lines inside the box', () => {
    render(
      <AddBar label="Tag" dropdown={<div>Suggestions</div>}>
        <p>Note</p>
      </AddBar>
    )
    const form = screen.getByLabelText('Tag').closest('form')
    expect(form).toContainElement(screen.getByText('Suggestions'))
    expect(form).toContainElement(screen.getByText('Note'))
  })
})
