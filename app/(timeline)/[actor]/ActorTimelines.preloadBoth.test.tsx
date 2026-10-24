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

// Counts how often each panel's module is evaluated (once per chunk load).
// Module counters are per file, so each profile shape gets its own file.
const loaded = vi.hoisted(() => ({ media: 0, gallery: 0 }))

vi.mock('@/lib/client', () => ({
  getActorStatuses: vi.fn()
}))

vi.mock('@/lib/components/posts/posts', () => ({
  Posts: () => <div data-testid="posts" />
}))

vi.mock('./ActorMediaGallery', () => {
  loaded.media += 1
  return { ActorMediaGallery: () => <div /> }
})

vi.mock('./ProfileGalleryTab', () => {
  loaded.gallery += 1
  return { ProfileGalleryTab: () => <div /> }
})

describe('ActorTimelines gallery tab preload', () => {
  it('loads both panels when the profile has a Media tab and a Gallery tab', async () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://mastodon.social/users/someone"
        statuses={[createStatus('status-1')]}
        attachments={[sampleAttachment]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        gallerySubviews={['recent']}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )
    fireEvent.pointerEnter(
      screen.getByRole('radiogroup', { name: 'Profile sections' })
    )
    await waitFor(() => expect(loaded.media).toBe(1))
    await waitFor(() => expect(loaded.gallery).toBe(1))
  })
})
