/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'

import { RecentFitnessActivities } from './RecentFitnessActivities'

vi.mock('@/lib/components/posts/posts', () => ({
  Posts: (props: {
    currentTime: number
    statuses: Status[]
    currentActor?: ActorProfile
    showActions?: boolean
  }) => (
    <div
      data-testid="posts"
      data-current-time={props.currentTime}
      data-current-actor={props.currentActor?.id ?? ''}
      data-show-actions={String(Boolean(props.showActions))}
    >
      {props.statuses.length} posts
    </div>
  )
}))

const FIXED_CURRENT_TIME = new Date('2026-04-30T10:05:00.000Z').getTime()

const profile: ActorProfile = {
  id: 'https://activities.local/users/llun',
  username: 'llun',
  domain: 'activities.local',
  name: 'Llun',
  followersUrl: 'https://activities.local/users/llun/followers',
  inboxUrl: 'https://activities.local/users/llun/inbox',
  sharedInboxUrl: 'https://activities.local/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: FIXED_CURRENT_TIME
}

const createStatus = (id: string): Status => ({
  id,
  actorId: profile.id,
  actor: profile,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: FIXED_CURRENT_TIME,
  updatedAt: FIXED_CURRENT_TIME,
  type: StatusType.enum.Note,
  url: id,
  text: id,
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  totalLikes: 0,
  attachments: [],
  tags: []
})

describe('RecentFitnessActivities', () => {
  it('renders nothing when statuses is empty', () => {
    const { container } = render(
      <RecentFitnessActivities
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        currentActor={profile}
        statuses={[]}
      />
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('posts')).not.toBeInTheDocument()
  })

  it('renders heading and posts stub when given one status', () => {
    const status = createStatus('https://activities.local/users/llun/s/1')

    render(
      <RecentFitnessActivities
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        currentActor={profile}
        statuses={[status]}
      />
    )

    expect(
      screen.getByRole('heading', { name: 'Recent activities' })
    ).toBeInTheDocument()

    const postsEl = screen.getByTestId('posts')
    expect(postsEl).toBeInTheDocument()
    expect(postsEl).toHaveAttribute(
      'data-current-time',
      String(FIXED_CURRENT_TIME)
    )
    expect(postsEl).toHaveTextContent('1 posts')
  })

  // This page lists nothing but the signed-in actor's OWN activities, and
  // `Post` decides whether to offer the source-file download by comparing
  // `currentActor` to the status author. Rendering `<Posts>` without a viewer
  // therefore denied the owner a link the endpoint would have served them —
  // which is exactly what shipped until a browser check caught it.
  it('hands Posts the viewer so the owner keeps their own download link', () => {
    const status = createStatus('https://activities.local/users/llun/s/2')

    render(
      <RecentFitnessActivities
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        currentActor={profile}
        statuses={[status]}
      />
    )

    expect(screen.getByTestId('posts')).toHaveAttribute(
      'data-current-actor',
      profile.id
    )
  })

  it('keeps the list read-only', () => {
    // `currentActor` without `showActions`: `Posts` gates the action row on
    // both, so passing the viewer for the ownership check must not quietly turn
    // this summary list into an interactive feed.
    const status = createStatus('https://activities.local/users/llun/s/3')

    render(
      <RecentFitnessActivities
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        currentActor={profile}
        statuses={[status]}
      />
    )

    expect(screen.getByTestId('posts')).toHaveAttribute(
      'data-show-actions',
      'false'
    )
  })
})
