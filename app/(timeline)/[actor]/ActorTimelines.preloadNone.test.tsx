/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { ActorTimelines } from './ActorTimelines'
import {
  FIXED_CURRENT_TIME,
  createStatus,
  currentActorProfile
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

const hoverTabs = () =>
  fireEvent.pointerEnter(
    screen.getByRole('radiogroup', { name: 'Profile sections' })
  )

describe('ActorTimelines with no gallery panel tab', () => {
  it('loads neither gallery panel on hover or focus of a Posts and Replies profile', async () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://mastodon.social/users/someone"
        statuses={[createStatus('status-1')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )
    expect(
      screen.getAllByRole('radio').map((radio) => radio.textContent)
    ).toEqual(['Posts', 'Replies'])
    hoverTabs()
    fireEvent.focus(screen.getAllByRole('radio')[0])
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(loaded.media).toBe(0)
    expect(loaded.gallery).toBe(0)
  })
})
