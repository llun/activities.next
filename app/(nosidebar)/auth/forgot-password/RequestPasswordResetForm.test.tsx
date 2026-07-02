/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { RequestPasswordResetForm } from './RequestPasswordResetForm'

describe('RequestPasswordResetForm', () => {
  it('submits with method="post" so the email stays out of the URL', () => {
    // A method-less <form> defaults to GET, which would append the email to the
    // URL if submitted before hydration or without JS.
    render(<RequestPasswordResetForm />)

    const form = screen
      .getByRole('button', { name: /send reset link/i })
      .closest('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
  })
})
