/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Actor } from '@/lib/types/domain/actor'

import Page from './page'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/app/(nosidebar)/getAuthLogoSrc', () => ({
  getAuthLogoSrc: () => '/logo-nav.png'
}))

// The real list is a client component that posts to the switch endpoint; the
// page's job is only to decide which actors it is handed.
vi.mock('./ActorSelectionList', () => ({
  ActorSelectionList: ({ actors }: { actors: { id: string }[] }) => (
    <ul data-testid="actor-list">
      {actors.map((actor) => (
        <li key={actor.id} data-testid={`actor-${actor.id}`} />
      ))}
    </ul>
  )
}))

const redirectMock = vi.fn((path: string) => path)
vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path)
}))

const buildActor = (overrides: Partial<Actor> = {}): Actor =>
  ({
    id: 'https://llun.test/users/one',
    type: 'Person',
    username: 'one',
    domain: 'llun.test',
    name: 'One',
    iconUrl: null,
    suspendedAt: null,
    deletionStatus: null,
    ...overrides
  }) as Actor

const getAccountFromEmailMock = vi.fn()
const getActorsForAccountMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { email: 'user@llun.test' }
  } as never)
  getAccountFromEmailMock.mockResolvedValue({ id: 'account-1' })
  vi.mocked(getDatabase).mockReturnValue({
    getAccountFromEmail: getAccountFromEmailMock,
    getActorsForAccount: getActorsForAccountMock
  } as unknown as ReturnType<typeof getDatabase>)
})

describe('/auth/select-actor', () => {
  it('offers only actors that can act, hiding suspended and deleting ones', async () => {
    const usable = buildActor({ id: 'https://llun.test/users/one' })
    const alsoUsable = buildActor({
      id: 'https://llun.test/users/four',
      username: 'four'
    })
    const suspended = buildActor({
      id: 'https://llun.test/users/two',
      username: 'two',
      suspendedAt: 1
    })
    const deleting = buildActor({
      id: 'https://llun.test/users/three',
      username: 'three',
      deletionStatus: 'scheduled'
    })
    getActorsForAccountMock.mockResolvedValue([
      usable,
      alsoUsable,
      suspended,
      deleting
    ])

    const element = await Page({})
    const { getByTestId, queryByTestId } = render(element as ReactElement)

    expect(redirectMock).not.toHaveBeenCalled()
    expect(getByTestId(`actor-${usable.id}`)).toBeInTheDocument()
    expect(getByTestId(`actor-${alsoUsable.id}`)).toBeInTheDocument()
    expect(queryByTestId(`actor-${suspended.id}`)).toBeNull()
    expect(queryByTestId(`actor-${deleting.id}`)).toBeNull()
  })

  it('redirects home when only one actor is usable', async () => {
    getActorsForAccountMock.mockResolvedValue([
      buildActor({ id: 'https://llun.test/users/one' }),
      buildActor({
        id: 'https://llun.test/users/two',
        username: 'two',
        suspendedAt: 1
      })
    ])

    await Page({})

    expect(redirectMock).toHaveBeenCalledWith('/')
  })

  it('redirects to sign-in without a session', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(null)

    await Page({})

    expect(redirectMock).toHaveBeenCalledWith('/auth/signin')
  })
})
