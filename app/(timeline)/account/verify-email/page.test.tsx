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

const renderPage = async (code?: string | string[]) =>
  render(await Page({ searchParams: Promise.resolve({ code }) }))

const signedIn = { id: 'actor-1', account: { id: 'acct-1' } }

describe('/account/verify-email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActorFromSession.mockResolvedValue(null)
  })

  it('confirms the change in a success alert and sends a signed-out visitor to sign in', async () => {
    verifyEmailChange.mockResolvedValue({ email: 'new@llun.test' })

    await renderPage('good-code')

    expect(verifyEmailChange).toHaveBeenCalledWith({
      emailChangeCode: 'good-code'
    })
    const alert = screen
      .getByText('Email verified')
      .closest('[data-slot="alert"]') as HTMLElement
    expect(alert).toHaveAttribute('data-tone', 'success')
    expect(alert).toHaveTextContent('changed to new@llun.test')
    expect(
      screen.getByText('Please sign in with your new email address.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/auth/signin'
    )
  })

  it('sends a signed-in visitor back to their account, with no sign-in prompt', async () => {
    verifyEmailChange.mockResolvedValue({ email: 'new@llun.test' })
    getActorFromSession.mockResolvedValue(signedIn)

    await renderPage('good-code')

    expect(screen.getByText('Email verified')).toBeInTheDocument()
    expect(
      screen.queryByText('Please sign in with your new email address.')
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to account' })).toHaveAttribute(
      'href',
      '/account'
    )
  })

  it('reports an invalid or expired link as an error, with the same destination rule', async () => {
    verifyEmailChange.mockResolvedValue(null)
    getActorFromSession.mockResolvedValue(signedIn)

    await renderPage('stale-code')

    const alert = screen
      .getByText('Verification failed')
      .closest('[data-slot="alert"]') as HTMLElement
    expect(alert).toHaveAttribute('data-tone', 'error')
    expect(alert).toHaveTextContent('invalid or has expired')
    expect(screen.getByRole('link', { name: 'Go to account' })).toBeVisible()
  })

  it('fails without asking the database when there is no code', async () => {
    await renderPage(undefined)

    expect(verifyEmailChange).not.toHaveBeenCalled()
    expect(screen.getByText('Verification failed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeVisible()
  })

  it('uses the first code when the link repeats the parameter', async () => {
    verifyEmailChange.mockResolvedValue({ email: 'new@llun.test' })

    await renderPage(['first', 'second'])

    expect(verifyEmailChange).toHaveBeenCalledWith({
      emailChangeCode: 'first'
    })
  })
})
