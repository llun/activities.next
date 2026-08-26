/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { AnchorHTMLAttributes, ReactNode } from 'react'

import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'

import { RecentFitnessActivities } from './RecentFitnessActivities'

// next/link swallows `prefetch` and `scroll` instead of reflecting them in the
// DOM, so they are rendered here to be assertable. Neither may be spread onto
// the `<a>`: they are not valid DOM attributes.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    scroll,
    prefetch,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean | 'auto' | null
    scroll?: boolean
    children: ReactNode
  }) => (
    <a
      href={href}
      data-prefetch={String(prefetch)}
      data-scroll={String(scroll)}
      {...rest}
    >
      {children}
    </a>
  )
}))

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
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: []
})

describe('RecentFitnessActivities', () => {
  it('shows nothing but the scope announcement when empty and unfiltered', () => {
    render(
      <RecentFitnessActivities
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        currentActor={profile}
        statuses={[]}
      />
    )

    expect(
      screen.queryByRole('heading', { name: 'Recent activities' })
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('posts')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()

    // The live region is the one thing this branch still renders. A region that
    // mounts already carrying its text announces nothing, so it has to be in
    // the tree BEFORE the first filter — and this is the branch an actor whose
    // activities have no surviving posts sits in while unfiltered.
    // It reports the OUTCOME, not the scope asked for: there is nothing to show,
    // and the region is the only thing that can say so — the visible empty
    // state is not itself a live region.
    expect(screen.getByRole('status')).toHaveTextContent(
      'No recent activities have been posted.'
    )
  })

  it('keeps the same status region across the first filter of a postless actor', () => {
    // The transition the hoist exists for: no section either side, so the only
    // thing that can announce is a text change inside a region that was already
    // mounted.
    const { rerender } = render(
      <RecentFitnessActivities
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        currentActor={profile}
        statuses={[]}
      />
    )

    const before = screen.getByRole('status')
    expect(before).toHaveTextContent('No recent activities have been posted.')

    rerender(
      <RecentFitnessActivities
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        currentActor={profile}
        statuses={[]}
        activityType="gravel_ride"
      />
    )

    const after = screen.getByRole('status')
    expect(after).toBe(before)
    expect(after).toHaveTextContent(
      'No recent Gravel Ride activities have been posted.'
    )
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
  it('offers a chip that clears the filter when one activity type is shown', () => {
    const status = createStatus('https://activities.local/users/llun/s/4')

    render(
      <RecentFitnessActivities
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        currentActor={profile}
        statuses={[status]}
        activityType="gravel_ride"
      />
    )

    const chip = screen.getByRole('link', { name: 'Clear Gravel Ride filter' })
    expect(chip).toHaveAttribute('href', '/fitness')
    expect(chip).toHaveTextContent('Gravel Ride')
    // Both are load-bearing and neither is visible to a functional assertion:
    // `scroll={false}` is why the live region is the only signal of the change,
    // and `prefetch={false}` keeps this dynamic page off the hover path.
    expect(chip).toHaveAttribute('data-scroll', 'false')
    expect(chip).toHaveAttribute('data-prefetch', 'false')
    expect(screen.getByTestId('posts')).toHaveTextContent('1 posts')
  })

  it('announces that a filter matched nothing rather than claiming a list', () => {
    // The one wrong thing this region could say. The visible empty state cannot
    // correct it: that paragraph is not a live region, and with focus unmoved
    // and the page unscrolled nothing carries the reader to it.
    render(
      <RecentFitnessActivities
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        currentActor={profile}
        statuses={[]}
        activityType="swimming"
      />
    )

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(
      'No recent Swimming activities have been posted.'
    )
    expect(status).not.toHaveTextContent('Showing')
  })

  it('keeps the section rendered when a filter matched nothing', () => {
    // The chip is the only way back out of a filter, so an empty filtered list
    // must not take the whole section — and its own early return — with it.
    render(
      <RecentFitnessActivities
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        currentActor={profile}
        statuses={[]}
        activityType="swimming"
      />
    )

    expect(
      screen.getByRole('link', { name: 'Clear Swimming filter' })
    ).toBeInTheDocument()
    // Twice on purpose: the sr-only region announces it, and the visible
    // paragraph below states it for everyone else. Assert the visible one
    // specifically, so this keeps testing what a sighted reader sees.
    const copies = screen.getAllByText(
      'No recent Swimming activities have been posted.'
    )
    expect(
      copies.filter((element) => element.getAttribute('role') !== 'status')
    ).toHaveLength(1)
    expect(screen.queryByTestId('posts')).not.toBeInTheDocument()
  })

  it.each([
    {
      description: 'names the active filter',
      activityType: 'gravel_ride',
      expected: 'Showing recent Gravel Ride activities'
    },
    {
      description: 'says so when nothing is filtered',
      activityType: undefined,
      expected: 'Showing all recent activities'
    }
  ])(
    'announces the current scope through a status region and $description',
    ({ activityType, expected }) => {
      // The navigation moves nothing else — scroll={false}, a static page
      // title, and aria-current flipping on the already-focused link — so this
      // region is the only thing that tells a screen reader the list changed.
      const status = createStatus('https://activities.local/users/llun/s/6')

      render(
        <RecentFitnessActivities
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          currentActor={profile}
          statuses={[status]}
          activityType={activityType}
        />
      )

      expect(screen.getByRole('status')).toHaveTextContent(expected)
    }
  )

  it('leaves the heading bare when nothing is filtered', () => {
    const status = createStatus('https://activities.local/users/llun/s/5')

    render(
      <RecentFitnessActivities
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        currentActor={profile}
        statuses={[status]}
      />
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
