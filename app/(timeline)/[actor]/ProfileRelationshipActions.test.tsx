/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'

import {
  ProfileRelationshipActions,
  isBlockedRelationship
} from './ProfileRelationshipActions'

vi.mock('@/lib/components/follow-action/follow-action', () => ({
  FollowAction: ({
    targetActorId,
    initialRelationship
  }: {
    targetActorId: string
    initialRelationship?: MastodonRelationship | null
  }) => (
    <div
      data-testid="follow-action"
      data-following={String(initialRelationship?.following)}
      data-requested={String(initialRelationship?.requested)}
    >
      {targetActorId}
    </div>
  )
}))

vi.mock('@/lib/components/block-action/block-action', () => ({
  BlockAction: ({ targetActorId }: { targetActorId: string }) => (
    <div data-testid="block-action">{targetActorId}</div>
  )
}))

vi.mock('@/lib/components/mute-action/mute-action', () => ({
  MuteAction: ({ targetActorId }: { targetActorId: string }) => (
    <div data-testid="mute-action">{targetActorId}</div>
  )
}))

vi.mock('@/lib/components/remote-follow/remote-follow-dialog', () => ({
  RemoteFollowDialog: ({ targetHandle }: { targetHandle: string }) => (
    <div data-testid="remote-follow-dialog">{targetHandle}</div>
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
  muting_expires_at: null,
  requested: false,
  requested_by: false,
  domain_blocking: false,
  endorsed: false,
  languages: ['en'],
  note: '',
  ...overrides
})

describe('ProfileRelationshipActions', () => {
  it('offers the remote follow dialog to a logged out visitor', () => {
    render(
      <ProfileRelationshipActions
        targetActorId="https://llun.test/users/local"
        targetHandle="local@llun.test"
        isLoggedIn={false}
        relationship={null}
      />
    )

    expect(screen.getByTestId('remote-follow-dialog')).toHaveTextContent(
      'local@llun.test'
    )
    expect(screen.queryByTestId('follow-action')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mute-action')).not.toBeInTheDocument()
    expect(screen.queryByTestId('block-action')).not.toBeInTheDocument()
  })

  it('does not offer the remote follow dialog to a signed in viewer', () => {
    render(
      <ProfileRelationshipActions
        targetActorId="https://remote.test/users/open"
        targetHandle="open@remote.test"
        isLoggedIn
        relationship={relationship()}
      />
    )

    expect(screen.queryByTestId('remote-follow-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('follow-action')).toBeInTheDocument()
  })

  it('hides the follow action when the current actor is blocking the profile actor', () => {
    render(
      <ProfileRelationshipActions
        targetActorId="https://remote.test/users/blocked"
        targetHandle="blocked@remote.test"
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
        targetHandle="open@remote.test"
        isLoggedIn
        relationship={relationship()}
      />
    )

    expect(screen.getByTestId('follow-action')).toHaveTextContent(
      'https://remote.test/users/open'
    )
    expect(screen.getByTestId('follow-action')).toHaveAttribute(
      'data-following',
      'false'
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

  it('turns Follow off for a viewer who does not follow a moved profile', () => {
    render(
      <ProfileRelationshipActions
        targetActorId="https://llun.test/users/moved"
        targetHandle="moved@llun.test"
        isLoggedIn
        relationship={relationship()}
        targetMoved
      />
    )

    const turnedOff = screen.getByRole('button', {
      name: /Follow turned off/
    })
    expect(turnedOff).toBeDisabled()
    expect(screen.queryByTestId('follow-action')).not.toBeInTheDocument()
    // Mute and block still make sense on a profile that moved.
    expect(screen.getByTestId('mute-action')).toBeInTheDocument()
    expect(screen.getByTestId('block-action')).toBeInTheDocument()
  })

  it('keeps Unfollow for a viewer who already follows a moved profile', () => {
    render(
      <ProfileRelationshipActions
        targetActorId="https://llun.test/users/moved"
        targetHandle="moved@llun.test"
        isLoggedIn
        relationship={relationship({ following: true })}
        targetMoved
      />
    )

    expect(screen.getByTestId('follow-action')).toHaveAttribute(
      'data-following',
      'true'
    )
    expect(
      screen.queryByRole('button', { name: /Follow turned off/ })
    ).not.toBeInTheDocument()
  })

  it('keeps the pending request action for a viewer whose request is outstanding', () => {
    render(
      <ProfileRelationshipActions
        targetActorId="https://llun.test/users/moved"
        targetHandle="moved@llun.test"
        isLoggedIn
        relationship={relationship({ requested: true })}
        targetMoved
      />
    )

    expect(screen.getByTestId('follow-action')).toHaveAttribute(
      'data-requested',
      'true'
    )
  })

  it('turns the remote follow dialog off for a logged out visitor to a moved profile', () => {
    render(
      <ProfileRelationshipActions
        targetActorId="https://llun.test/users/moved"
        targetHandle="moved@llun.test"
        isLoggedIn={false}
        relationship={null}
        targetMoved
      />
    )

    expect(
      screen.getByRole('button', { name: /Follow turned off/ })
    ).toBeDisabled()
    expect(screen.queryByTestId('remote-follow-dialog')).not.toBeInTheDocument()
  })
})
