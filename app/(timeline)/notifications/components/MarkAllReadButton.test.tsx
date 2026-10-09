/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { createDeferred } from '@/lib/testing/deferred'

import { MarkAllReadButton } from './MarkAllReadButton'

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh })
}))

const mockMarkNotificationsRead = vi.fn()
vi.mock('@/lib/client', () => ({
  markNotificationsRead: (params: { notificationIds: string[] }) =>
    mockMarkNotificationsRead(params)
}))

describe('MarkAllReadButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // mockReset also drops any unused mock...Once value from an earlier test.
    mockMarkNotificationsRead.mockReset()
    mockMarkNotificationsRead.mockResolvedValue(true)
  })

  afterEach(() => {
    cleanup()
  })

  it('marks all unread ids read in one request and refreshes the page', async () => {
    render(<MarkAllReadButton unreadIds={['a', 'b', 'c']} unreadCount={3} />)

    fireEvent.click(screen.getByRole('button', { name: /mark all read/i }))

    await vi.waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
    expect(mockMarkNotificationsRead).toHaveBeenCalledExactlyOnceWith({
      notificationIds: ['a', 'b', 'c']
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is disabled when there is nothing unread', () => {
    render(<MarkAllReadButton unreadIds={[]} unreadCount={0} />)

    expect(
      screen.getByRole('button', { name: /mark all read/i })
    ).toBeDisabled()
  })

  it('disables the button while the request is in flight', async () => {
    const deferred = createDeferred<boolean>()
    mockMarkNotificationsRead.mockReturnValue(deferred.promise)
    render(<MarkAllReadButton unreadIds={['a']} unreadCount={1} />)
    const button = screen.getByRole('button', { name: /mark all read/i })

    fireEvent.click(button)
    await vi.waitFor(() => expect(button).toBeDisabled())

    deferred.resolve(true)
    await vi.waitFor(() => expect(button).toBeEnabled())
  })

  it.each([
    ['the server rejects the request', () => Promise.resolve(false)],
    ['the request throws', () => Promise.reject(new Error('offline'))]
  ])('shows an error and does not refresh when %s', async (_, impl) => {
    mockMarkNotificationsRead.mockImplementation(impl)
    render(<MarkAllReadButton unreadIds={['a']} unreadCount={1} />)

    fireEvent.click(screen.getByRole('button', { name: /mark all read/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't mark read"
    )
    expect(mockRefresh).not.toHaveBeenCalled()
    // The button is usable again so the user can retry.
    expect(screen.getByRole('button', { name: /mark all read/i })).toBeEnabled()
  })

  it('clears the error when a retry succeeds', async () => {
    mockMarkNotificationsRead.mockResolvedValueOnce(false)
    render(<MarkAllReadButton unreadIds={['a']} unreadCount={1} />)
    const button = screen.getByRole('button', { name: /mark all read/i })

    fireEvent.click(button)
    await screen.findByRole('alert')
    fireEvent.click(button)

    await vi.waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    )
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('hides the badge when nothing is unread', () => {
    render(<MarkAllReadButton unreadIds={['a']} unreadCount={0} />)

    expect(screen.queryByText(/^\d+\+?$/)).not.toBeInTheDocument()
  })

  it.each([
    [5, '5'],
    [99, '99'],
    [100, '99+']
  ])('shows unread count %s as badge %s', (unreadCount, badge) => {
    render(<MarkAllReadButton unreadIds={['a']} unreadCount={unreadCount} />)

    expect(screen.getByText(badge)).toBeInTheDocument()
  })
})
