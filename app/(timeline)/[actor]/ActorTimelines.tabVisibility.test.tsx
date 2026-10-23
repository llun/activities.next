/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ActorTimelines } from './ActorTimelines'
import {
  FIXED_CURRENT_TIME,
  createFitnessStatus,
  createStatus,
  currentActorProfile,
  sampleAttachment
} from './ActorTimelines.testUtils'

vi.mock('@/lib/client', () => ({
  getActorStatuses: vi.fn(),
  getAccountStatusesPage: vi.fn()
}))

vi.mock('@/lib/components/posts/posts', async () => ({
  Posts: (await import('./ActorTimelines.testUtils')).MockPosts
}))

vi.mock('./ProfileGalleryTab', async () => ({
  ProfileGalleryTab: (await import('./ActorTimelines.testUtils'))
    .MockProfileGalleryTab
}))

vi.mock('./ActorMediaGallery', async () => ({
  ActorMediaGallery: (await import('./ActorTimelines.testUtils'))
    .MockActorMediaGallery
}))

vi.mock('@/lib/components/ui/button', async () => ({
  Button: (await import('./ActorTimelines.testUtils')).MockButton
}))

beforeAll(async () => {
  await import('./ActorMediaGallery')
  await import('./ProfileGalleryTab')
})

const ALL_SHOWN = { replies: true, media: true, gallery: true, fitness: true }

const renderTimelines = (
  props: Partial<React.ComponentProps<typeof ActorTimelines>> = {}
) =>
  render(
    <ActorTimelines
      host="llun.test"
      actorId="https://llun.test/users/me"
      statuses={[createFitnessStatus('https://llun.test/statuses/run')]}
      attachments={[sampleAttachment]}
      currentTime={FIXED_CURRENT_TIME}
      currentActor={currentActorProfile}
      isCurrentUser
      hasFitnessData
      hasGalleryMedia
      gallerySubviews={['subjects', 'recent']}
      statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      {...props}
    />
  )

const tabNames = () =>
  screen
    .queryAllByRole('radio')
    .map((tab) => tab.getAttribute('aria-label') ?? tab.textContent)

describe('ActorTimelines tab visibility', () => {
  it('offers every tab when nothing is hidden, and by default', () => {
    const { unmount } = renderTimelines({ tabVisibility: ALL_SHOWN })
    expect(tabNames()).toEqual([
      'Posts',
      'Replies',
      'Media',
      'Gallery',
      'Fitness'
    ])
    unmount()

    renderTimelines()
    expect(tabNames()).toEqual([
      'Posts',
      'Replies',
      'Media',
      'Gallery',
      'Fitness'
    ])
  })

  it.each([
    { hidden: 'replies', label: 'Replies' },
    { hidden: 'media', label: 'Media' },
    { hidden: 'gallery', label: 'Gallery' },
    { hidden: 'fitness', label: 'Fitness' }
  ])(
    'hides the $label tab from its owner and keeps the others',
    ({ hidden, label }) => {
      renderTimelines({ tabVisibility: { ...ALL_SHOWN, [hidden]: false } })

      expect(
        screen.queryByRole('radio', { name: label })
      ).not.toBeInTheDocument()
      const expected = [
        'Posts',
        'Replies',
        'Media',
        'Gallery',
        'Fitness'
      ].filter((name) => name !== label)
      expect(tabNames()).toEqual(expected)
    }
  )

  it('hides the tab from a visitor as well', () => {
    renderTimelines({
      isCurrentUser: false,
      currentActor: undefined,
      tabVisibility: { ...ALL_SHOWN, gallery: false }
    })

    expect(
      screen.queryByRole('radio', { name: 'Gallery' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Posts' })).toBeChecked()
  })

  it('shows only the posts feed, with no tab bar, when every optional tab is hidden', () => {
    renderTimelines({
      statuses: [createStatus('https://llun.test/statuses/note')],
      tabVisibility: {
        replies: false,
        media: false,
        gallery: false,
        fitness: false
      }
    })

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(
      screen.getByText('https://llun.test/statuses/note')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('mock-media-gallery')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mock-gallery-tab')).not.toBeInTheDocument()
  })

  describe('a media-only profile', () => {
    it('opens on the media grid while the Media tab is shown', async () => {
      renderTimelines({
        isInternalAccount: false,
        isMediaOnly: true,
        attachments: [sampleAttachment],
        tabVisibility: ALL_SHOWN
      })

      expect(
        await screen.findByTestId('mock-media-gallery')
      ).toBeInTheDocument()
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    })

    it('falls back to Posts instead of a hidden Media tab', () => {
      renderTimelines({
        isInternalAccount: true,
        isMediaOnly: true,
        statuses: [createStatus('https://llun.test/statuses/note')],
        attachments: [sampleAttachment],
        hasFitnessData: false,
        hasGalleryMedia: false,
        gallerySubviews: [],
        tabVisibility: { ...ALL_SHOWN, media: false }
      })

      expect(screen.queryByTestId('mock-media-gallery')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('radio', { name: 'Media' })
      ).not.toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Posts' })).toBeChecked()
      expect(
        screen.getByText('https://llun.test/statuses/note')
      ).toBeInTheDocument()
    })
  })
})
