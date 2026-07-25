/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { NotificationSettings } from './NotificationSettings'
import { PushNotificationSettings } from './PushNotificationSettings'

const mockGetVapidKey = vi.fn()
const mockUpdateReplyByEmail = vi.fn()

vi.mock('@/lib/client', () => ({
  getVapidKey: () => mockGetVapidKey(),
  subscribePushNotifications: vi.fn(),
  unsubscribePushNotifications: vi.fn(),
  updateEmailNotifications: vi.fn(),
  updatePushNotifications: vi.fn(),
  updateReplyByEmail: (actorId: string, enabled: boolean) =>
    mockUpdateReplyByEmail(actorId, enabled)
}))

describe('Notification settings', () => {
  const notificationTypes = [
    {
      key: 'mention',
      label: 'Mentions',
      description: 'Someone mentions you'
    }
  ]
  const actors = [
    {
      id: 'actor-1',
      username: 'alice',
      domain: 'llun.test',
      name: 'Alice'
    }
  ]

  beforeEach(() => {
    mockUpdateReplyByEmail.mockReset()
    mockUpdateReplyByEmail.mockResolvedValue(true)
    mockGetVapidKey.mockResolvedValue(null)
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: function PushManager() {}
    })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn()
      }
    })
  })

  it('does not render environment variable names when push notifications are not configured', async () => {
    render(
      <NotificationSettings
        actorId="actor-1"
        accountEmail="alice@llun.test"
        actors={actors}
        notificationTypes={notificationTypes}
      />
    )

    expect(
      await screen.findByText(/Push notifications are not configured/i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/ACTIVITIES_/)).not.toBeInTheDocument()
  })

  it('hides the reply-by-email toggle when the instance cannot receive replies', async () => {
    render(
      <NotificationSettings
        actorId="actor-1"
        accountEmail="alice@llun.test"
        actors={actors}
        notificationTypes={notificationTypes}
      />
    )

    await screen.findByText(/Push notifications are not configured/i)
    expect(screen.queryByLabelText('Reply by email')).not.toBeInTheDocument()
  })

  it('shows the reply-by-email toggle off by default when available', async () => {
    render(
      <NotificationSettings
        actorId="actor-1"
        accountEmail="alice@llun.test"
        actors={actors}
        notificationTypes={notificationTypes}
        replyByEmailAvailable
      />
    )

    expect(await screen.findByLabelText('Reply by email')).not.toBeChecked()
  })

  it('saves the reply-by-email opt-in for the selected actor', async () => {
    render(
      <NotificationSettings
        actorId="actor-1"
        accountEmail="alice@llun.test"
        actors={actors}
        notificationTypes={notificationTypes}
        replyByEmailAvailable
      />
    )

    fireEvent.click(await screen.findByLabelText('Reply by email'))

    await waitFor(() =>
      expect(mockUpdateReplyByEmail).toHaveBeenCalledWith('actor-1', true)
    )
    expect(await screen.findByLabelText('Reply by email')).toBeChecked()
  })

  it('reverts the reply-by-email toggle when the save fails', async () => {
    mockUpdateReplyByEmail.mockResolvedValue(false)
    render(
      <NotificationSettings
        actorId="actor-1"
        accountEmail="alice@llun.test"
        actors={actors}
        notificationTypes={notificationTypes}
        replyByEmailAvailable
        replyByEmail
      />
    )

    fireEvent.click(await screen.findByLabelText('Reply by email'))

    await waitFor(() =>
      expect(mockUpdateReplyByEmail).toHaveBeenCalledWith('actor-1', false)
    )
    // A failed save must not leave the UI claiming the capability is off.
    expect(await screen.findByLabelText('Reply by email')).toBeChecked()
  })

  it('does not render environment variable names in the legacy push settings component', async () => {
    render(
      <PushNotificationSettings
        actorId="actor-1"
        notificationTypes={notificationTypes}
      />
    )

    expect(
      await screen.findByText(/Push notifications are not configured/i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/ACTIVITIES_/)).not.toBeInTheDocument()
  })
})
