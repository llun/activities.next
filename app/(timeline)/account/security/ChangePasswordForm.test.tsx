/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render } from '@testing-library/react'

import { ChangePasswordForm } from './ChangePasswordForm'

describe('ChangePasswordForm', () => {
  it('renders the form with method="post" (defense-in-depth against a native GET submit)', () => {
    // Controlled, unnamed inputs mean a native submit sends nothing today, but a
    // method-less <form> defaults to GET; POST keeps the current/new password out
    // of the URL if a `name`/autocomplete attribute is added later.
    const { container } = render(<ChangePasswordForm />)

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
  })
})
