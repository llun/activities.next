import type { ReactElement, ReactNode } from 'react'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import {
  SERVED_DOMAIN_REFRESH_MS,
  refreshServedDomains,
  resetServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { PasskeyManager } from './PasskeyManager'
import Page from './page'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => path)
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: 'run.example' }))
}))

const findPasskeyManager = (
  node: ReactNode
): ReactElement<{
  currentDomain: string
  domains: { domain: string }[]
}> | null => {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findPasskeyManager(child)
      if (found) return found
    }
    return null
  }
  const element = node as ReactElement<{ children?: ReactNode }>
  if (element.type === PasskeyManager) {
    return element as unknown as ReactElement<{
      currentDomain: string
      domains: { domain: string }[]
    }>
  }
  return findPasskeyManager(element.props?.children)
}

describe('/account/security', () => {
  beforeEach(() => {
    vi.mocked(getDatabase).mockReturnValue(
      {} as unknown as ReturnType<typeof getDatabase>
    )
    vi.mocked(getServerAuthSession).mockResolvedValue(
      {} as unknown as Awaited<ReturnType<typeof getServerAuthSession>>
    )
    vi.mocked(getActorFromSession).mockResolvedValue({
      id: 'https://run.example/users/ana',
      username: 'ana',
      account: { id: 'account-id', twoFactorEnabled: false }
    } as unknown as Awaited<ReturnType<typeof getActorFromSession>>)
  })

  afterEach(() => {
    vi.useRealTimers()
    resetServedDomainsForTests()
  })

  // On a stale snapshot a domain an admin turned on would read as untrusted:
  // the passkey chooser would miss it and "here" would be the primary.
  it('refreshes a stale served-domain snapshot before resolving the current domain', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const getActiveServedDomains = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ domain: 'run.example' }])
    await refreshServedDomains({
      getActiveServedDomains
    } as unknown as Database)
    vi.advanceTimersByTime(SERVED_DOMAIN_REFRESH_MS + 1)

    const manager = findPasskeyManager(await Page())

    expect(manager?.props.currentDomain).toBe('run.example')
    expect(manager?.props.domains.map(({ domain }) => domain)).toContain(
      'run.example'
    )
  })
})
