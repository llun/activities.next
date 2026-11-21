/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'

import Page from './page'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

const redirectMock = vi.fn((path: string) => path)
vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path)
}))

const aSession = { user: { email: 'rider@example.com' } } as Awaited<
  ReturnType<typeof getServerAuthSession>
>

describe('/auth/forgot-password page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDatabase).mockReturnValue({} as unknown as Database)
  })

  // The account email page tells a passwordless account to use "Forgot
  // password" to set one, so a signed-in user must reach this page rather than
  // be bounced home.
  it('renders the request form for a signed-in user instead of redirecting home', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(aSession)

    const element = await Page({})

    expect(redirectMock).not.toHaveBeenCalled()
    render(element)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Forgot your password?' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /send reset link/i })
    ).toBeInTheDocument()
  })

  it('renders the request form for a signed-out visitor', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(null)

    const element = await Page({})

    expect(redirectMock).not.toHaveBeenCalled()
    render(element)
    expect(
      screen.getByRole('button', { name: /send reset link/i })
    ).toBeInTheDocument()
  })
})
