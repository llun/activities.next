/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { RequestPasswordResetForm } from './RequestPasswordResetForm'

describe('RequestPasswordResetForm', () => {
  it('renders the form with method="post" (defense-in-depth against a native GET submit)', () => {
    // The email input is controlled and unnamed, so a native submit sends nothing
    // today; method="post" guards against a `name` addition later,
    // since a method-less <form> defaults to GET.
    render(<RequestPasswordResetForm />)

    const form = screen
      .getByRole('button', { name: /send reset link/i })
      .closest('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
  })
})
