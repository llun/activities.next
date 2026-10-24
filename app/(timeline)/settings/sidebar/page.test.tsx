import { redirect } from 'next/navigation'

import { NavigationSettings } from '@/lib/components/settings/NavigationSettings'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getVisitedFeatures } from '@/lib/services/domains/visitedFeatures'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

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

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn()
}))

vi.mock('@/lib/services/domains/visitedFeatures', () => ({
  getVisitedFeatures: vi.fn()
}))

vi.mock('@/lib/components/settings/NavigationSettings', () => ({
  NavigationSettings: vi.fn(() => null)
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn()
}))

describe('settings/sidebar page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDatabase).mockReturnValue({} as never)
    vi.mocked(getResolvedServerSettings).mockResolvedValue({
      features: {}
    } as never)
    vi.mocked(getVisitedFeatures).mockResolvedValue({} as never)
  })

  it('redirects to signin if actor has no session or account', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(null)
    vi.mocked(getActorFromSession).mockResolvedValue(null)

    await Page()

    expect(redirect).toHaveBeenCalledWith('/auth/signin')
  })

  it('renders NavigationSettings passing the actor profileUrl', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { email: 'alice@example.com' }
    })
    vi.mocked(getActorFromSession).mockResolvedValue({
      username: 'alice',
      domain: 'example.com',
      account: { role: 'admin' }
    } as never)

    const element = await Page()

    expect(element?.type).toBe(NavigationSettings)
    expect(element?.props).toEqual(
      expect.objectContaining({
        profileUrl: '/@alice@example.com',
        fitnessUrl: '/fitness',
        galleryUrl: '/gallery',
        isAdmin: true
      })
    )
  })
})
