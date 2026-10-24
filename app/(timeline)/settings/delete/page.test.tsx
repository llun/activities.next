/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'

const getActorsForAccount = vi.fn()
const mockDatabase = { getActorsForAccount }

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => mockDatabase)
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'anna@llun.test' }
  })
}))

const ACTOR = {
  id: 'https://llun.test/users/anna',
  username: 'anna',
  domain: 'llun.test',
  name: 'Anna',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  inboxUrl: 'https://llun.test/users/anna/inbox',
  sharedInboxUrl: 'https://llun.test/inbox',
  followersUrl: 'https://llun.test/users/anna/followers',
  publicKey: 'public-key',
  deletionStatus: null,
  account: { id: 'acct-1', defaultActorId: null }
}

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirect(path)
}))

const deleteActorSectionProps = vi.fn()
vi.mock('@/lib/components/settings/DeleteActorSection', () => ({
  DeleteActorSection: (props: Record<string, unknown>) => {
    deleteActorSectionProps(props)
    return <div data-testid="delete-actor" />
  }
}))

describe('/settings/delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActorFromSession).mockResolvedValue(ACTOR as never)
    getActorsForAccount.mockResolvedValue([
      { id: 'https://llun.test/users/anna', deletionStatus: null }
    ])
  })

  it('renders header with "Delete this profile" and description', async () => {
    render(await Page())

    expect(
      screen.getByRole('heading', { level: 1, name: 'Delete this profile' })
    ).toBeVisible()
    expect(
      screen.getByText('Irreversible actions for this profile.')
    ).toBeVisible()
  })

  it('passes correct props to DeleteActorSection', async () => {
    render(await Page())

    expect(deleteActorSectionProps).toHaveBeenCalledWith({
      actorId: 'https://llun.test/users/anna',
      actorUsername: 'anna',
      actorDomain: 'llun.test',
      isDefaultActor: false,
      isOnlyActor: true,
      deletionStatus: null
    })
  })

  it('correctly calculates isOnlyActor with multiple actors', async () => {
    getActorsForAccount.mockResolvedValue([
      { id: 'https://llun.test/users/anna', deletionStatus: null },
      { id: 'https://llun.test/users/bob', deletionStatus: null }
    ])

    render(await Page())

    expect(deleteActorSectionProps).toHaveBeenCalledWith(
      expect.objectContaining({
        isOnlyActor: false
      })
    )
  })

  it('redirects to /auth/signin if unauthenticated', async () => {
    vi.mocked(getActorFromSession).mockResolvedValue(null as never)

    await expect(Page()).rejects.toThrow('redirect:/auth/signin')
  })
})
