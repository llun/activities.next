/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { NotificationSettings } from './NotificationSettings'
import { PushNotificationSettings } from './PushNotificationSettings'

const mockGetVapidKey = jest.fn()

jest.mock('@/lib/client', () => ({
  getVapidKey: () => mockGetVapidKey(),
  subscribePushNotifications: jest.fn(),
  unsubscribePushNotifications: jest.fn(),
  updateEmailNotifications: jest.fn(),
  updatePushNotifications: jest.fn()
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
    mockGetVapidKey.mockResolvedValue(null)
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: function PushManager() {}
    })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: jest.fn()
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
})
