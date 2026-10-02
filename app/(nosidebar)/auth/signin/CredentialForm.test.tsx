/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { useRouter, useSearchParams } from 'next/navigation'

import { authClient } from '@/lib/services/auth/auth-client'

import { CredentialForm } from './CredentialForm'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn()
}))

vi.mock('@/lib/services/auth/auth-client', () => ({
  authClient: {
    signIn: {
      email: vi.fn()
    }
  }
}))

describe('CredentialForm', () => {
  beforeEach(() => {
    vi.mocked(useRouter).mockReturnValue({
      push: vi.fn()
    } as unknown as ReturnType<typeof useRouter>)
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>
    )
    vi.mocked(authClient.signIn.email).mockReset()
  })

  it('submits with method="post" so credentials never land in the URL query string', () => {
    // A method-less <form> defaults to GET, which serializes the email and
    // password into the URL if the form is submitted before hydration or with
    // JS disabled. Forcing POST keeps them in the request body in every case.
    render(<CredentialForm providerName="credentials" />)

    const form = screen
      .getByRole('button', { name: /sign in/i })
      .closest('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
  })

  it('draws the Email and Password labels on a 14/20 line, not the shared 14 px one', () => {
    render(<CredentialForm providerName="credentials" />)

    // The sign-in board draws its labels 20 high, so the input sits 26 pt
    // below the label's top; the shared Label's `leading-none` would put it
    // closer. Only this form opts in: the sign-up card keeps the shared one.
    for (const name of ['Email', 'Password']) {
      const label = screen.getByText(name)
      expect(label).toHaveClass('leading-5')
      expect(label).not.toHaveClass('leading-none')
    }
  })
})
