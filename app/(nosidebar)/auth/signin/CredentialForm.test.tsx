/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRouter, useSearchParams } from 'next/navigation'

import { authClient } from '@/lib/services/auth/auth-client'
import { createDeferred } from '@/lib/testing/deferred'

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

const push = vi.fn()

const setSearchParams = (query: string) =>
  vi
    .mocked(useSearchParams)
    .mockReturnValue(
      new URLSearchParams(query) as unknown as ReturnType<
        typeof useSearchParams
      >
    )

const signIn = async (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: password }
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
  })
}

describe('CredentialForm', () => {
  beforeEach(() => {
    push.mockReset()
    vi.mocked(useRouter).mockReturnValue({
      push
    } as unknown as ReturnType<typeof useRouter>)
    setSearchParams('')
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

  it('names the provider on the submit button', () => {
    render(<CredentialForm providerName="Activities" />)

    expect(
      screen.getByRole('button', { name: 'Sign in with Activities' })
    ).toBeEnabled()
  })

  it('signs in with the lower-cased email and goes home', async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      data: {},
      error: null
    } as never)
    render(<CredentialForm providerName="credentials" />)

    // jsdom already strips surrounding whitespace from type="email" values,
    // so trimming cannot be observed here.
    await signIn('Me@Example.COM', 'hunter2')

    expect(authClient.signIn.email).toHaveBeenCalledWith({
      email: 'me@example.com',
      password: 'hunter2'
    })
    expect(push).toHaveBeenCalledWith('/')
  })

  it('returns to a safe redirectBack path after signing in', async () => {
    setSearchParams('redirectBack=%2Fsettings%2Faccount')
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      data: {},
      error: null
    } as never)
    render(<CredentialForm providerName="credentials" />)

    await signIn('me@example.com', 'hunter2')

    expect(push).toHaveBeenCalledWith('/settings/account')
  })

  it('continues to two-factor verification, carrying the redirect target', async () => {
    setSearchParams('redirectBack=%2Fsettings%2Faccount')
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null
    } as never)
    render(<CredentialForm providerName="credentials" />)

    await signIn('me@example.com', 'hunter2')

    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith(
      '/auth/two-factor?redirectBack=%2Fsettings%2Faccount'
    )
  })

  it.each([
    ['', 'hunter2', 'Email is required'],
    ['me@example.com', '', 'Password is required']
  ])(
    'blocks a submit with email %j and password %j',
    async (email, password, message) => {
      render(<CredentialForm providerName="credentials" />)

      await signIn(email, password)

      expect(screen.getByText(message)).toBeInTheDocument()
      expect(authClient.signIn.email).not.toHaveBeenCalled()
      expect(push).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled()
    }
  )

  it('shows the server’s message when sign-in is rejected', async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      data: null,
      error: { message: 'Invalid email or password' }
    } as never)
    render(<CredentialForm providerName="credentials" />)

    await signIn('me@example.com', 'wrong')

    expect(screen.getByText('Invalid email or password')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled()
  })

  it('falls back to a generic message when the rejection has none', async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      data: null,
      error: { message: '' }
    } as never)
    render(<CredentialForm providerName="credentials" />)

    await signIn('me@example.com', 'wrong')

    expect(screen.getByText('Sign in failed')).toBeInTheDocument()
  })

  it('shows a retry message when the request throws', async () => {
    vi.mocked(authClient.signIn.email).mockRejectedValue(
      new Error('network down')
    )
    render(<CredentialForm providerName="credentials" />)

    await signIn('me@example.com', 'hunter2')

    expect(
      screen.getByText('Sign in failed. Please try again.')
    ).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled()
  })

  it('disables the button while signing in and clears an earlier error', async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid email or password' }
    } as never)
    render(<CredentialForm providerName="credentials" />)
    await signIn('me@example.com', 'wrong')
    expect(screen.getByText('Invalid email or password')).toBeInTheDocument()

    const pending = createDeferred<unknown>()
    vi.mocked(authClient.signIn.email).mockReturnValueOnce(
      pending.promise as never
    )
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(screen.getByRole('button', { name: 'Signing in...' })).toBeDisabled()
    expect(
      screen.queryByText('Invalid email or password')
    ).not.toBeInTheDocument()

    await act(async () => {
      pending.resolve({ data: {}, error: null })
    })
    expect(push).toHaveBeenCalledWith('/')
  })
})
