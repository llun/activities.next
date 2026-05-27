/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'

import {
  ProfileRelationshipActions,
  isBlockedRelationship
} from './ProfileRelationshipActions'

jest.mock('@/lib/components/follow-action/follow-action', () => ({
  FollowAction: ({ targetActorId }: { targetActorId: string }) => (
    <div data-testid="follow-action">{targetActorId}</div>
  )
}))

jest.mock('@/lib/components/block-action/block-action', () => ({
  BlockAction: ({ targetActorId }: { targetActorId: string }) => (
    <div data-testid="block-action">{targetActorId}</div>
  )
}))

jest.mock('@/lib/components/mute-action/mute-action', () => ({
  MuteAction: ({ targetActorId }: { targetActorId: string }) => (
    <div data-testid="mute-action">{targetActorId}</div>
  )
}))

const relationship = (
  overrides: Partial<MastodonRelationship> = {}
): MastodonRelationship => ({
  id: 'target',
  following: false,
  showing_reblogs: false,
  notifying: false,
  followed_by: false,
  blocking: false,
  blocked_by: false,
  muting: false,
  muting_notifications: false,
  requested: false,
  requested_by: false,
  domain_blocking: false,
  endorsed: false,
  languages: ['en'],
  note: '',
  ...overrides
})

describe('ProfileRelationshipActions', () => {
  it('hides the follow action when the current actor is blocking the profile actor', () => {
    render(
      <ProfileRelationshipActions
        targetActorId="https://remote.test/users/blocked"
        isLoggedIn
        relationship={relationship({ blocking: true })}
      />
    )

    expect(screen.queryByTestId('follow-action')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mute-action')).not.toBeInTheDocument()
    expect(screen.getByTestId('block-action')).toHaveTextContent(
      'https://remote.test/users/blocked'
    )
  })

  it('shows the follow and mute actions when the relationship is not blocked', () => {
    render(
      <ProfileRelationshipActions
        targetActorId="https://remote.test/users/open"
        isLoggedIn
        relationship={relationship()}
      />
    )

    expect(screen.getByTestId('follow-action')).toHaveTextContent(
      'https://remote.test/users/open'
    )
    expect(screen.getByTestId('mute-action')).toHaveTextContent(
      'https://remote.test/users/open'
    )
    expect(screen.getByTestId('block-action')).toHaveTextContent(
      'https://remote.test/users/open'
    )
  })

  it('treats either block direction as a blocked relationship', () => {
    expect(isBlockedRelationship(relationship({ blocking: true }))).toBe(true)
    expect(isBlockedRelationship(relationship({ blocked_by: true }))).toBe(true)
    expect(isBlockedRelationship(relationship())).toBe(false)
  })
})
