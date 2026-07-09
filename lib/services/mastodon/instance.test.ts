import type { Config } from '@/lib/config'
import { Database } from '@/lib/database/types'

import {
  EMPTY_INSTANCE_STATS,
  getInstanceContactAccount,
  getInstanceContactEmail,
  getInstanceStats
} from './instance'

describe('getInstanceContactEmail', () => {
  it.each([
    {
      description:
        'returns the outbound sender address when email is configured',
      config: {
        email: { type: 'smtp', serviceFromAddress: 'admin@llun.test' }
      },
      expected: 'admin@llun.test'
    },
    {
      description: 'unwraps a Name <address> sender format',
      config: {
        email: { type: 'smtp', serviceFromAddress: 'Admin <admin@llun.test>' }
      },
      expected: 'admin@llun.test'
    },
    {
      description:
        'falls back to the vapid contact and strips the mailto prefix',
      config: {
        push: {
          vapidPublicKey: 'pub',
          vapidPrivateKey: 'priv',
          vapidEmail: 'mailto:push@llun.test'
        }
      },
      expected: 'push@llun.test'
    },
    {
      description: 'prefers the email sender over the vapid contact',
      config: {
        email: { type: 'smtp', serviceFromAddress: 'admin@llun.test' },
        push: {
          vapidPublicKey: 'pub',
          vapidPrivateKey: 'priv',
          vapidEmail: 'mailto:push@llun.test'
        }
      },
      expected: 'admin@llun.test'
    },
    {
      description: 'returns an empty string when nothing is configured',
      config: {},
      expected: ''
    }
  ])('$description', ({ config, expected }) => {
    expect(
      getInstanceContactEmail(config as Pick<Config, 'email' | 'push'>)
    ).toBe(expected)
  })
})

describe('getInstanceStats', () => {
  it('maps nodeinfo counters and the peers list onto instance stats', async () => {
    const database = {
      getNodeInfoStats: vi.fn().mockResolvedValue({
        totalUsers: 3,
        activeMonth: 2,
        activeHalfyear: 3,
        localPosts: 42
      }),
      getInstancePeers: vi
        .fn()
        .mockResolvedValue(['mastodon.social', 'pixelfed.social'])
    } as unknown as Database

    await expect(getInstanceStats(database, 'llun.test')).resolves.toEqual({
      userCount: 3,
      statusCount: 42,
      domainCount: 2,
      activeMonth: 2
    })
    expect(database.getInstancePeers).toHaveBeenCalledWith({
      localDomain: 'llun.test'
    })
  })

  it('returns zeroed stats when the database is unavailable', async () => {
    await expect(getInstanceStats(null, 'llun.test')).resolves.toEqual(
      EMPTY_INSTANCE_STATS
    )
  })

  it('returns zeroed stats when a stats query fails', async () => {
    const database = {
      getNodeInfoStats: vi.fn().mockRejectedValue(new Error('boom')),
      getInstancePeers: vi.fn().mockResolvedValue([])
    } as unknown as Database

    await expect(getInstanceStats(database, 'llun.test')).resolves.toEqual(
      EMPTY_INSTANCE_STATS
    )
  })
})

describe('getInstanceContactAccount', () => {
  const adminAccount = {
    id: 'https://llun.test/users/admin',
    username: 'admin'
  }

  it('returns the mastodon account for the instance admin actor', async () => {
    const database = {
      getInstanceAdminActorId: vi
        .fn()
        .mockResolvedValue('https://llun.test/users/admin'),
      getMastodonActorFromId: vi.fn().mockResolvedValue(adminAccount)
    } as unknown as Database

    await expect(getInstanceContactAccount(database)).resolves.toEqual(
      adminAccount
    )
    expect(database.getMastodonActorFromId).toHaveBeenCalledWith({
      id: 'https://llun.test/users/admin'
    })
  })

  it('returns null when the instance has no admin account', async () => {
    const database = {
      getInstanceAdminActorId: vi.fn().mockResolvedValue(null),
      getMastodonActorFromId: vi.fn()
    } as unknown as Database

    await expect(getInstanceContactAccount(database)).resolves.toBeNull()
    expect(database.getMastodonActorFromId).not.toHaveBeenCalled()
  })

  it('returns null when the database is unavailable', async () => {
    await expect(getInstanceContactAccount(null)).resolves.toBeNull()
  })

  it('returns null when the admin lookup fails', async () => {
    const database = {
      getInstanceAdminActorId: vi.fn().mockRejectedValue(new Error('boom')),
      getMastodonActorFromId: vi.fn()
    } as unknown as Database

    await expect(getInstanceContactAccount(database)).resolves.toBeNull()
  })
})
