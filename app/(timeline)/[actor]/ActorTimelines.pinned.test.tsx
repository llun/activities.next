/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { ActorTimelines } from '@/app/(timeline)/[actor]/ActorTimelines'
import {
  FIXED_CURRENT_TIME,
  createReplyStatus,
  createStatus,
  currentActorProfile
} from '@/app/(timeline)/[actor]/ActorTimelines.testUtils'

vi.mock('@/lib/client', () => ({
  getActorStatuses: vi.fn(),
  getAccountStatusesPage: vi.fn()
}))

vi.mock('@/lib/components/posts/posts', async () => ({
  Posts: (await import('@/app/(timeline)/[actor]/ActorTimelines.testUtils'))
    .MockPosts
}))

vi.mock('@/lib/components/posts/timeline-feed', async () => ({
  TimelineFeed: (
    await import('@/app/(timeline)/[actor]/ActorTimelines.testUtils')
  ).MockPosts
}))

vi.mock('@/app/(timeline)/[actor]/ActorMediaGallery', async () => ({
  ActorMediaGallery: (
    await import('@/app/(timeline)/[actor]/ActorTimelines.testUtils')
  ).MockActorMediaGallery
}))

vi.mock('@/app/(timeline)/[actor]/ProfileGalleryTab', async () => ({
  ProfileGalleryTab: (
    await import('@/app/(timeline)/[actor]/ActorTimelines.testUtils')
  ).MockProfileGalleryTab
}))

vi.mock('@/lib/components/ui/button', async () => ({
  Button: (await import('@/app/(timeline)/[actor]/ActorTimelines.testUtils'))
    .MockButton
}))

describe('ActorTimelines pinned statuses', () => {
  const actorId = 'https://mastodon.example/users/alex'
  const pinnedPostId = 'https://mastodon.example/statuses/pinned-1'
  const regularPostId = 'https://mastodon.example/statuses/regular-1'
  const replyPostId = 'https://mastodon.example/statuses/reply-1'

  it('shows the Pinned label and the pins first on Posts', () => {
    const { container } = render(
      <ActorTimelines
        host="localhost:3000"
        actorId={actorId}
        statuses={[createStatus(regularPostId)]}
        pinnedStatuses={[createStatus(pinnedPostId)]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(screen.getByText('Pinned')).toBeInTheDocument()
    expect(screen.getByText(pinnedPostId)).toBeInTheDocument()
    expect(screen.getByText(regularPostId)).toBeInTheDocument()

    // Pins appear first in the DOM before regular statuses
    const textContent = container.textContent || ''
    const pinnedIndex = textContent.indexOf(pinnedPostId)
    const regularIndex = textContent.indexOf(regularPostId)
    expect(pinnedIndex).toBeGreaterThan(-1)
    expect(regularIndex).toBeGreaterThan(-1)
    expect(pinnedIndex).toBeLessThan(regularIndex)
  })

  it('follows a new pinned list after the page refreshes (pin or unpin)', () => {
    const props = {
      host: 'localhost:3000',
      actorId,
      statuses: [createStatus(regularPostId)],
      attachments: [],
      currentTime: FIXED_CURRENT_TIME,
      currentActor: currentActorProfile,
      statusPagination: { nextPageUrl: null, prevPageUrl: null }
    }
    const { rerender } = render(
      <ActorTimelines
        {...props}
        pinnedStatuses={[createStatus(pinnedPostId)]}
      />
    )
    expect(screen.getByText('Pinned')).toBeInTheDocument()

    // The unpin's router.refresh sends the list without the post.
    rerender(<ActorTimelines {...props} pinnedStatuses={[]} />)
    expect(screen.queryByText('Pinned')).not.toBeInTheDocument()
    expect(screen.queryByText(pinnedPostId)).not.toBeInTheDocument()

    // A refresh that drops the prop clears the list too.
    rerender(
      <ActorTimelines
        {...props}
        pinnedStatuses={[createStatus(pinnedPostId)]}
      />
    )
    expect(screen.getByText('Pinned')).toBeInTheDocument()
    rerender(<ActorTimelines {...props} />)
    expect(screen.queryByText('Pinned')).not.toBeInTheDocument()
  })

  it('shows the pins and not the empty state when there are pins but no regular posts', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId={actorId}
        statuses={[]}
        pinnedStatuses={[createStatus(pinnedPostId)]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(screen.getByText('Pinned')).toBeInTheDocument()
    expect(screen.getByText(pinnedPostId)).toBeInTheDocument()
    expect(screen.queryByText('No posts yet')).not.toBeInTheDocument()
  })

  it('shows the empty state when there are neither pins nor posts', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId={actorId}
        statuses={[]}
        pinnedStatuses={[]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(screen.queryByText('Pinned')).not.toBeInTheDocument()
    expect(screen.getByText('No posts yet')).toBeInTheDocument()
  })

  it('does not show the Pinned label or pins on other tabs', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId={actorId}
        statuses={[createReplyStatus(replyPostId)]}
        pinnedStatuses={[createStatus(pinnedPostId)]}
        repliesTabStatusIds={[replyPostId]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    // On Posts tab initially, Pinned label and pinned post are shown
    expect(screen.getByText('Pinned')).toBeInTheDocument()
    expect(screen.getByText(pinnedPostId)).toBeInTheDocument()

    // Switch to Replies tab
    const repliesTab = screen.getByRole('radio', { name: 'Replies' })
    fireEvent.click(repliesTab)

    // On Replies tab, Pinned label and pinned post are NOT shown
    expect(screen.queryByText('Pinned')).not.toBeInTheDocument()
    expect(screen.queryByText(pinnedPostId)).not.toBeInTheDocument()
    expect(screen.getByText(replyPostId)).toBeInTheDocument()

    // Switch back to Posts tab
    const postsTab = screen.getByRole('radio', { name: 'Posts' })
    fireEvent.click(postsTab)

    // Pinned post and label are visible again
    expect(screen.getByText('Pinned')).toBeInTheDocument()
    expect(screen.getByText(pinnedPostId)).toBeInTheDocument()
  })
})
