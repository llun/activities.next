/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ResetPasswordForm } from './ResetPasswordForm'

describe('ResetPasswordForm', () => {
  it('submits with method="post" so the reset code and password stay out of the URL', () => {
    // A method-less <form> defaults to GET, which would serialize the reset code
    // and new password into the URL if submitted before hydration or without JS.
    render(<ResetPasswordForm />)

    const form = screen
      .getByRole('button', { name: /reset password/i })
      .closest('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
  })
})
