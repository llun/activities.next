import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
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

vi.mock('@/lib/components/settings/FitnessFileManagement', () => ({
  FitnessFileManagement: vi.fn(() => null)
}))

vi.mock('@/lib/components/settings/FitnessImport', () => ({
  FitnessImport: vi.fn(() => null)
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn()
}))

describe('fitness/files page, signed out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDatabase).mockReturnValue({} as never)
    vi.mocked(getServerAuthSession).mockResolvedValue(null)
    vi.mocked(getActorFromSession).mockResolvedValue(null)
  })

  it('redirects to sign-in', async () => {
    await Page({ searchParams: Promise.resolve({}) })

    expect(redirect).toHaveBeenCalledWith('/auth/signin')
  })

  // A batch share whose session expired: the staged files stay on the device,
  // and sign-in brings the reader back to them.
  it('keeps a staged share in redirectBack', async () => {
    await Page({ searchParams: Promise.resolve({ share: 'share-1' }) })

    expect(redirect).toHaveBeenCalledWith(
      `/auth/signin?redirectBack=${encodeURIComponent('/fitness/files?share=share-1')}`
    )
  })

  it('encodes the share id inside redirectBack', async () => {
    await Page({ searchParams: Promise.resolve({ share: 'a&b=c' }) })

    expect(redirect).toHaveBeenCalledWith(
      `/auth/signin?redirectBack=${encodeURIComponent(`/fitness/files?share=${encodeURIComponent('a&b=c')}`)}`
    )
  })
})
