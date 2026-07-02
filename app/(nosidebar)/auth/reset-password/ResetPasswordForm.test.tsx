/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ResetPasswordForm } from './ResetPasswordForm'

describe('ResetPasswordForm', () => {
  it('renders the form with method="post" (defense-in-depth against a native GET submit)', () => {
    // These inputs are controlled and unnamed, so a native submit sends nothing
    // today; method="post" guards against a `name`/autocomplete addition later,
    // since a method-less <form> defaults to GET.
    render(<ResetPasswordForm />)

    const form = screen
      .getByRole('button', { name: /reset password/i })
      .closest('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
  })
})
