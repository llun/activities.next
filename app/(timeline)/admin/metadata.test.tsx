/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { metadata as accountsMetadata } from './accounts/page'
import { metadata as domainsMetadata } from './domains/page'
import { metadata as emojisMetadata } from './emojis/page'
import { metadata as federationMetadata } from './federation/page'
import { metadata as instanceMetadata } from './instance/page'
import { metadata as networkMetadata } from './network/page'
import { metadata as postsMetadata } from './posts/page'
import { metadata as queuesMetadata } from './queues/page'
import { metadata as relaysMetadata } from './relays/page'
import { metadata as reportsMetadata } from './reports/page'
import { metadata as systemMetadata } from './system/page'
import { metadata as tagsMetadata } from './tags/page'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({}))
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({}))
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getServerSettingsView: vi.fn()
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn()
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn()
}))

describe('admin page metadata', () => {
  it('titles each admin page with its nav label', () => {
    const cases = [
      [accountsMetadata, 'Accounts'],
      [domainsMetadata, 'Served domains'],
      [emojisMetadata, 'Custom emojis'],
      [federationMetadata, 'Federation'],
      [instanceMetadata, 'Server settings'],
      [networkMetadata, 'Network'],
      [postsMetadata, 'Posts & media'],
      [queuesMetadata, 'Queues'],
      [relaysMetadata, 'Relays'],
      [reportsMetadata, 'Reports'],
      [systemMetadata, 'System'],
      [tagsMetadata, 'Hashtags']
    ] as const

    for (const [metadata, title] of cases) {
      expect(metadata?.title).toBe(title)
    }
  })
})
