/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Page from './page'

const verifyEmailChange = vi.fn()
const getActorFromSession = vi.fn()

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({ verifyEmailChange }))
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue(null)
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => getActorFromSession(...args)
}))

vi.mock('@/lib/components/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>
}))

const renderPage = async (
  params: Record<string, string | string[] | undefined>
) => render(await Page({ searchParams: Promise.resolve(params) }))

const signedIn = { id: 'actor-1', account: { id: 'acct-1' } }

describe('/account/verify-email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActorFromSession.mockResolvedValue(null)
  })

  it('is read-only: opening the link never applies the change', async () => {
    await renderPage({ code: 'good-code' })

    expect(verifyEmailChange).not.toHaveBeenCalled()
  })

  it('shows a confirm button that POSTs the code to the confirm route', async () => {
    const { container } = render(
      await Page({ searchParams: Promise.resolve({ code: 'good-code' }) })
    )

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute(
      'action',
      '/api/v1/accounts/email/verify/confirm'
    )
    expect(form?.querySelector('input[name="code"]')).toHaveValue('good-code')
    expect(
      screen.getByRole('button', { name: 'Confirm email change' })
    ).toBeInTheDocument()
  })

  it('uses the first code when the link repeats the parameter', async () => {
    const { container } = render(
      await Page({
        searchParams: Promise.resolve({ code: ['first', 'second'] })
      })
    )

    expect(container.querySelector('input[name="code"]')).toHaveValue('first')
  })

  it('reports a verified change in a success alert and sends a signed-out visitor to sign in', async () => {
    await renderPage({ status: 'verified' })

    const alert = screen
      .getByText('Email verified')
      .closest('[data-slot="alert"]') as HTMLElement
    expect(alert).toHaveAttribute('data-tone', 'success')
    expect(
      screen.getByText('Please sign in with your new email address.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/auth/signin'
    )
  })

  it('sends a signed-in visitor back to their account, with no sign-in prompt', async () => {
    getActorFromSession.mockResolvedValue(signedIn)

    await renderPage({ status: 'verified' })

    expect(screen.getByText('Email verified')).toBeInTheDocument()
    expect(
      screen.queryByText('Please sign in with your new email address.')
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Go to Email & name' })
    ).toHaveAttribute('href', '/account/email')
  })

  it('reports an invalid or expired link as an error, with the same destination rule', async () => {
    getActorFromSession.mockResolvedValue(signedIn)

    await renderPage({ status: 'invalid' })

    const alert = screen
      .getByText('Verification failed')
      .closest('[data-slot="alert"]') as HTMLElement
    expect(alert).toHaveAttribute('data-tone', 'error')
    expect(alert).toHaveTextContent('invalid or has expired')
    expect(
      screen.getByRole('link', { name: 'Go to Email & name' })
    ).toBeVisible()
  })

  it('asks for a link when opened with no code and no status', async () => {
    await renderPage({})

    expect(verifyEmailChange).not.toHaveBeenCalled()
    expect(
      screen.getByText('Open the link from your email')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeVisible()
  })
})
