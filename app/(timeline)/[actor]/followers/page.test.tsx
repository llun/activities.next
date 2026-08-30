/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { notFound, redirect } from 'next/navigation'

import { getProfileData } from '@/app/(timeline)/[actor]/getProfileData'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'

const mockDatabase = {
  getFollowers: vi.fn(),
  getActorFromId: vi.fn()
}

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
  redirect: vi.fn()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  isLocalFederationDomain: vi.fn()
}))

vi.mock('@/app/(timeline)/[actor]/getProfileData', () => ({
  getProfileData: vi.fn()
}))

vi.mock('@/app/(timeline)/[actor]/FollowList', () => ({
  FollowList: () => <div data-testid="follow-list" />
}))

vi.mock('@/app/(timeline)/[actor]/getFollowListBlockedActorIds', () => ({
  getFollowListBlockedActorIds: vi.fn().mockResolvedValue([])
}))

const mockGetServerAuthSession = vi.mocked(getServerAuthSession)
const mockGetActorFromSession = vi.mocked(getActorFromSession)
const mockIsLocalFederationDomain = vi.mocked(isLocalFederationDomain)
const mockGetProfileData = vi.mocked(getProfileData)
const mockRedirect = vi.mocked(redirect)
const mockNotFound = vi.mocked(notFound)

describe('[actor] followers page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorFromSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(false)
    mockGetProfileData.mockResolvedValue(null)
  })

  it('redirects logged-out visitors on non-local actor to the main actor profile', async () => {
    mockGetServerAuthSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(false)
    mockGetProfileData.mockResolvedValue(null)

    await Page({
      params: Promise.resolve({ actor: '@clairenony@pouet.chapril.org' })
    })

    expect(mockRedirect).toHaveBeenCalledWith('/@clairenony@pouet.chapril.org')
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  it('calls notFound for local actor when profile is not found', async () => {
    mockGetServerAuthSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(true)
    mockGetProfileData.mockResolvedValue(null)

    await Page({
      params: Promise.resolve({ actor: '@unknown@llun.social' })
    })

    expect(mockNotFound).toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
