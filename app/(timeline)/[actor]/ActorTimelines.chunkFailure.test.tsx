/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ActorTimelines } from './ActorTimelines'
import {
  FIXED_CURRENT_TIME,
  createStatus,
  currentActorProfile,
  sampleAttachment
} from './ActorTimelines.testUtils'

// The App Router's `next/dynamic` (React.lazy based), which rethrows a failed
// import as a render error; vitest otherwise resolves the Pages Router one.
vi.mock('next/dynamic', async () => ({
  default: (await import('next/dist/shared/lib/app-dynamic')).default
}))

vi.mock('@/lib/client', () => ({
  getActorStatuses: vi.fn()
}))

vi.mock('./ActorMediaGallery', () => {
  throw new Error('Loading chunk failed')
})

vi.mock('./ProfileGalleryTab', () => {
  throw new Error('Loading chunk failed')
})

describe('ActorTimelines when a gallery chunk fails to load', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows an inline message instead of throwing to the route error page', async () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://mastodon.social/users/someone"
        statuses={[createStatus('status-1')]}
        attachments={[sampleAttachment]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        isMediaOnly
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(await screen.findByText("Couldn't load")).toBeInTheDocument()
  })
})
