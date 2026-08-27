/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

import type { ActorProfile } from '@/lib/types/domain/actor'
import {
  StatusAnnounce,
  StatusNote,
  StatusType
} from '@/lib/types/domain/status'

import { BoostStatus } from './post'

// next/link swallows `prefetch` instead of reflecting it in the DOM, so the
// only way to assert on it is to render the prop ourselves.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean | 'auto' | null
    children: ReactNode
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  )
}))

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

const booster: ActorProfile = {
  id: 'https://remote.example/users/booster',
  username: 'booster',
  domain: 'remote.example',
  name: 'Booster',
  followersUrl: 'https://remote.example/users/booster/followers',
  inboxUrl: 'https://remote.example/users/booster/inbox',
  sharedInboxUrl: 'https://remote.example/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: currentTime
}

const originalStatus: StatusNote = {
  id: 'https://origin.example/users/original/statuses/post-1',
  actorId: 'https://origin.example/users/original',
  actor: null,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: false,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: 'https://origin.example/@original/post-1',
  text: 'Original post',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: []
}

const boost: StatusAnnounce = {
  id: 'https://remote.example/users/booster/statuses/boost-1/activity',
  actorId: booster.id,
  actor: booster,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: false,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Announce,
  originalStatus
}

describe('BoostStatus', () => {
  it('links the booster display name to their profile page', () => {
    render(<BoostStatus status={boost} />)

    const link = screen.getByRole('link', { name: 'Booster' })
    expect(link).toHaveAttribute('href', '/@booster@remote.example')
    expect(link.parentElement).toHaveTextContent('Boosted by Booster')
  })

  // A feed renders this row once per boost, and `<Link>` prefetches on viewport
  // entry, so scrolling would fire an RSC request per boosted row against a
  // fully dynamic route that federates out for unpersisted remote actors.
  it('does not prefetch the booster profile link', () => {
    render(<BoostStatus status={boost} />)

    expect(screen.getByRole('link', { name: 'Booster' })).toHaveAttribute(
      'data-prefetch',
      'false'
    )
  })

  it('normalises a malformed federated username before rendering it as the link text', () => {
    render(
      <BoostStatus
        status={{
          ...boost,
          actor: { ...booster, name: '', username: '@booster' }
        }}
      />
    )

    const link = screen.getByRole('link', { name: 'booster' })
    expect(link).toHaveAttribute('href', '/@booster@remote.example')
  })

  it('links the handle recovered from the actor id when the profile is absent', () => {
    render(
      <BoostStatus
        status={{
          ...boost,
          actor: null,
          actorId: 'https://remote.example/users/booster'
        }}
      />
    )

    const link = screen.getByRole('link', { name: '@booster@remote.example' })
    expect(link).toHaveAttribute('href', '/@booster@remote.example')
    expect(link).toHaveAttribute('data-prefetch', 'false')
  })

  it('renders plain text when the actor id carries no usable handle', () => {
    render(
      <BoostStatus
        status={{
          ...boost,
          actor: null,
          actorId: 'https://bsky.brid.gy/ap/did:plc:booster'
        }}
      />
    )

    expect(screen.getByText('Boosted by @bsky.brid.gy')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders nothing for a status that is not a boost', () => {
    const { container } = render(<BoostStatus status={originalStatus} />)

    expect(container).toBeEmptyDOMElement()
  })
})
