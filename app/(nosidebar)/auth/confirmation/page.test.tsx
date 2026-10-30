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

describe('/auth/confirmation page', () => {
  const verifyAccountMock = vi.fn()
  const mockDatabase = {
    verifyAccount: verifyAccountMock
  } as unknown as Database

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDatabase).mockReturnValue(mockDatabase)
  })

  it('consumes the verification code even when an active session exists (avoids stuck unconfirmed accounts on repoint/rotation)', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(aSession)
    verifyAccountMock.mockResolvedValue({ id: 'account-1' })

    const element = await Page({
      searchParams: Promise.resolve({ verificationCode: 'valid-code' })
    })

    expect(verifyAccountMock).toHaveBeenCalledWith({
      verificationCode: 'valid-code'
    })
    expect(redirectMock).not.toHaveBeenCalled()
    render(element)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Confirm your account' })
    ).toBeInTheDocument()
    expect(screen.getByText('Your account is verified')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Continue to sign in' })
    ).toHaveAttribute('href', '/auth/signin')
  })

  it('shows invalid verification code when code fails verification even with an active session', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(aSession)
    verifyAccountMock.mockResolvedValue(null)

    const element = await Page({
      searchParams: Promise.resolve({ verificationCode: 'bad-code' })
    })

    expect(verifyAccountMock).toHaveBeenCalledWith({
      verificationCode: 'bad-code'
    })
    expect(redirectMock).not.toHaveBeenCalled()
    render(element)
    expect(screen.getByText('Invalid verification code')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to sign in' })
    ).toHaveAttribute('href', '/auth/signin')
  })

  it('redirects to home when an active session exists and no verification code is present', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(aSession)

    await Page({
      searchParams: Promise.resolve({})
    })

    expect(redirectMock).toHaveBeenCalledTimes(1)
    expect(redirectMock).toHaveBeenCalledWith('/')
    expect(verifyAccountMock).not.toHaveBeenCalled()
  })

  it('redirects to home when an active session exists and verification code is empty', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(aSession)

    await Page({
      searchParams: Promise.resolve({ verificationCode: '' })
    })

    expect(redirectMock).toHaveBeenCalledTimes(1)
    expect(redirectMock).toHaveBeenCalledWith('/')
    expect(verifyAccountMock).not.toHaveBeenCalled()
  })

  it('consumes the verification code for a logged-out visitor', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(null)
    verifyAccountMock.mockResolvedValue({ id: 'account-1' })

    const element = await Page({
      searchParams: Promise.resolve({ verificationCode: 'valid-code' })
    })

    expect(verifyAccountMock).toHaveBeenCalledWith({
      verificationCode: 'valid-code'
    })
    expect(redirectMock).not.toHaveBeenCalled()
    render(element)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Confirm your account' })
    ).toBeInTheDocument()
    expect(screen.getByText('Your account is verified')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Continue to sign in' })
    ).toHaveAttribute('href', '/auth/signin')
  })

  it('picks the first code when verificationCode is an array', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(null)
    verifyAccountMock.mockResolvedValue({ id: 'account-1' })

    const element = await Page({
      searchParams: Promise.resolve({
        verificationCode: ['first-code', 'second-code']
      })
    })

    expect(verifyAccountMock).toHaveBeenCalledWith({
      verificationCode: 'first-code'
    })
    expect(redirectMock).not.toHaveBeenCalled()
    render(element)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Confirm your account' })
    ).toBeInTheDocument()
    expect(screen.getByText('Your account is verified')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Continue to sign in' })
    ).toHaveAttribute('href', '/auth/signin')
  })

  it('shows invalid verification code when logged out with no verification code', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(null)

    const element = await Page({
      searchParams: Promise.resolve({})
    })

    expect(redirectMock).not.toHaveBeenCalled()
    expect(verifyAccountMock).not.toHaveBeenCalled()
    render(element)
    expect(screen.getByText('Invalid verification code')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to sign in' })
    ).toHaveAttribute('href', '/auth/signin')
  })

  it('throws an error when database is not available', async () => {
    vi.mocked(getDatabase).mockReturnValue(null)
    vi.mocked(getServerAuthSession).mockResolvedValue(null)

    await expect(
      Page({
        searchParams: Promise.resolve({ verificationCode: 'valid-code' })
      })
    ).rejects.toThrow('Database is not available')
  })
})
