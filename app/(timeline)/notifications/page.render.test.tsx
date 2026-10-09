/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import Page from './page'

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
  redirect: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'llun.social' })
}))

const mockGetDatabase = vi.fn()
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockGetDatabase()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => Promise.resolve({ user: { id: 'account-1' } })
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: () =>
    Promise.resolve({ id: 'https://llun.social/users/llun' })
}))

const emptyDatabase = {
  getNotifications: vi.fn().mockResolvedValue([]),
  getNotificationsCount: vi.fn().mockResolvedValue(0)
}

describe('notifications page when there is nothing to show', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetDatabase.mockReturnValue(emptyDatabase)
  })

  afterEach(() => cleanup())

  it('says the viewer is caught up on All, with no action to take', async () => {
    render(await Page({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText("You're all caught up")).toBeInTheDocument()
    expect(
      screen.getByText('New activity will show up here.')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Show all notifications' })
    ).not.toBeInTheDocument()
  })

  it('offers a way back to All when Mentions is empty', async () => {
    render(await Page({ searchParams: Promise.resolve({ type: 'mentions' }) }))

    expect(screen.getByText('No mentions or replies yet.')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Show all notifications' })
    ).toHaveAttribute('href', '/notifications')
    expect(emptyDatabase.getNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['mention', 'reply'] })
    )
  })

  it('puts the filter tabs and a refresh control in the header', async () => {
    render(await Page({ searchParams: Promise.resolve({ type: 'mentions' }) }))

    expect(screen.getByRole('link', { name: 'Mentions' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh notifications' })
    )
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })
})
