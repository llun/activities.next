/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { NotificationSettings } from './NotificationSettings'
import { PushNotificationSettings } from './PushNotificationSettings'

const mockGetVapidKey = vi.fn()

vi.mock('@/lib/client', () => ({
  getVapidKey: () => mockGetVapidKey(),
  subscribePushNotifications: vi.fn(),
  unsubscribePushNotifications: vi.fn(),
  updateEmailNotifications: vi.fn(),
  updatePushNotifications: vi.fn()
}))

describe('Notification settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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

  it('draws the channel titles on a 14/20 line and leaves other labels alone', async () => {
    // Push is only listed once the server has a VAPID key.
    mockGetVapidKey.mockResolvedValue('test-vapid-key')
    vi.stubGlobal('Notification', { permission: 'default' })
    render(
      <NotificationSettings
        actorId="actor-1"
        accountEmail="alice@llun.test"
        actors={actors}
        notificationTypes={notificationTypes}
      />
    )

    // The Channels card's switch-row titles are 20 high on the board; the
    // shared Label's `leading-none` is the default everywhere else.
    for (const title of ['Email (alice@llun.test)', 'Push Notifications']) {
      const label = await screen.findByText(title)
      expect(label).toHaveClass('leading-5')
      expect(label).not.toHaveClass('leading-none')
    }
  })

  it('sets the helper text under each channel and event row at 12/16', async () => {
    render(
      <NotificationSettings
        actorId="actor-1"
        accountEmail="alice@llun.test"
        actors={actors}
        notificationTypes={notificationTypes}
      />
    )

    for (const text of [
      'Email notifications are enabled.',
      'Someone mentions you'
    ]) {
      const helper = await screen.findByText(text)
      expect(helper).toHaveClass('text-xs')
      expect(helper).not.toHaveClass('text-[0.8rem]')
    }
  })
})
