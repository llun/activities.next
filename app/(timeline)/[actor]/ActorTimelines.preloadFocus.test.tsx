/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { ActorTimelines } from './ActorTimelines'
import {
  FIXED_CURRENT_TIME,
  createStatus,
  currentActorProfile,
  sampleAttachment
} from './ActorTimelines.testUtils'

const loaded = vi.hoisted(() => ({ media: 0, gallery: 0 }))

vi.mock('@/lib/client', () => ({
  getActorStatuses: vi.fn()
}))

vi.mock('@/lib/components/posts/posts', () => ({
  Posts: ({ prioritizeFirstMedia }: { prioritizeFirstMedia?: boolean }) => (
    <div data-testid="posts" data-prioritize={String(prioritizeFirstMedia)} />
  )
}))

vi.mock('./ActorMediaGallery', () => {
  loaded.media += 1
  return { ActorMediaGallery: () => <div data-testid="mock-media-gallery" /> }
})

vi.mock('./ProfileGalleryTab', () => {
  loaded.gallery += 1
  return { ProfileGalleryTab: () => <div data-testid="mock-gallery-tab" /> }
})

const renderTimelines = () =>
  render(
    <ActorTimelines
      host="localhost:3000"
      actorId="https://mastodon.social/users/someone"
      statuses={[createStatus('status-1')]}
      attachments={[sampleAttachment]}
      currentTime={FIXED_CURRENT_TIME}
      currentActor={currentActorProfile}
      statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
    />
  )

describe('ActorTimelines tab bar focus', () => {
  it('preloads only the media gallery when a tab takes focus (no Gallery tab)', async () => {
    renderTimelines()
    expect(loaded.media + loaded.gallery).toBe(0)

    fireEvent.focus(screen.getAllByRole('radio')[0])
    await waitFor(() => {
      expect(loaded.media).toBe(1)
      expect(loaded.gallery).toBe(0)
    })
  })
})
