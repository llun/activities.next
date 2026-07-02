/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { ChangeEmailForm } from './ChangeEmailForm'

describe('ChangeEmailForm', () => {
  it('renders the form with method="post" (defense-in-depth against a native GET submit)', () => {
    // Controlled, unnamed input means a native submit sends nothing today, but a
    // method-less <form> defaults to GET; POST keeps the email out of the URL if a
    // `name` attribute is added later.
    const { container } = render(
      <ChangeEmailForm currentEmail="user@example.com" />
    )

    // The form is revealed only after entering edit mode.
    fireEvent.click(screen.getByRole('button', { name: /change email/i }))

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
  })
})
