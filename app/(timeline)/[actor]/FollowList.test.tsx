/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import type { ActorProfile } from '@/lib/types/domain/actor'

import { FollowList } from './FollowList'

vi.mock('@/lib/components/follow-action/follow-action', () => ({
  FollowAction: ({ targetActorId }: { targetActorId: string }) => (
    <button type="button">Follow {targetActorId}</button>
  )
}))

const actorProfile = (id: string, username: string): ActorProfile => ({
  id,
  username,
  domain: 'example.test',
  name: username,
  summary: '',
  iconUrl: '',
  headerImageUrl: '',
  followersUrl: `${id}/followers`,
  inboxUrl: `${id}/inbox`,
  sharedInboxUrl: 'https://example.test/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 0
})

describe('FollowList', () => {
  it('hides follow actions for blocked relationships', () => {
    render(
      <FollowList
        users={[
          actorProfile('https://example.test/users/visible', 'visible'),
          actorProfile('https://example.test/users/blocked', 'blocked')
        ]}
        isLoggedIn
        blockedActorIds={['https://example.test/users/blocked']}
      />
    )

    expect(
      screen.getByRole('button', {
        name: 'Follow https://example.test/users/visible'
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'Follow https://example.test/users/blocked'
      })
    ).not.toBeInTheDocument()
  })

  it('renders follow actions by default when no blocked actor IDs are provided', () => {
    render(
      <FollowList
        users={[actorProfile('https://example.test/users/visible', 'visible')]}
        isLoggedIn
      />
    )

    expect(
      screen.getByRole('button', {
        name: 'Follow https://example.test/users/visible'
      })
    ).toBeInTheDocument()
  })
})
