/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'

import type { ActorProfile } from '@/lib/types/domain/actor'

import {
  buildReactedStatus,
  buildStatus,
  notMe,
  renderDetail,
  resetFitnessStatusDetailMocks
} from './FitnessStatusDetail.testUtils'

vi.mock('@/lib/client', () => ({
  getFitnessFilesByStatus: vi.fn(),
  getFitnessGearList: vi.fn(),
  getFitnessRouteData: vi.fn(),
  updateFitnessFileGear: vi.fn()
}))

vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn()
}))

// The keyless GL loader never resolves here, so the interactive map stays in its
// initializing state (no real MapLibre script is injected in jsdom).
vi.mock('@/lib/utils/maplibre', () => ({
  loadMaplibreModule: vi.fn(() => new Promise(() => {})),
  OPENFREEMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/bright',
  OPENFREEMAP_HEATMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/positron'
}))

vi.mock('next/navigation', async () => {
  const { mockPush, mockRefresh } = await import('./FitnessStatusDetail.mocks')
  return { useRouter: () => ({ refresh: mockRefresh, push: mockPush }) }
})

vi.mock('@/lib/utils/getStatusDetailPathClient', () => ({
  getStatusDetailPathClient: vi.fn(
    async (status: { id: string }) => `/@actor/${status.id}`
  )
}))

vi.mock('@/lib/components/posts/actor', () => ({
  ActorAvatar: () => <div data-testid="actor-avatar" />
}))

vi.mock('@/lib/components/posts/media', () => ({
  Media: () => <div data-testid="media" />
}))

// The MapKit surface is the one map path that is a component rather than an
// imperative GL handle, so it is where a test can read back the instant the
// page is asking the map to highlight.
vi.mock('@/lib/components/fitness/ActivityRouteMapKit', async () => ({
  ActivityRouteMapKit: (await import('./FitnessStatusDetail.mocks'))
    .MockActivityRouteMapKit
}))

vi.mock('@/lib/components/posts/post', async () => ({
  Post: (await import('./FitnessStatusDetail.mocks')).MockPost
}))

vi.mock('@/lib/components/posts/status-reply-box', () => ({
  StatusReplyBox: () => <div data-testid="comment-composer" />
}))

// Stubbed for the same reason `BrandedDeviceLink` is: this page only has to
// open the shared composer in the right mode against the right status and put
// it in the right place. What each mode renders is
// `lib/components/posts/inline-status-composer.test.tsx`'s job.
vi.mock('@/lib/components/posts/inline-status-composer', async () => ({
  InlineStatusComposer: (await import('./FitnessStatusDetail.mocks'))
    .MockInlineStatusComposer
}))

vi.mock('@/lib/components/posts/actions/reply-button', () => ({
  ReplyButton: ({ onReply }: { onReply?: () => void }) => (
    <button type="button" onClick={() => onReply?.()}>
      Reply
    </button>
  )
}))

vi.mock('@/lib/components/posts/actions/repost-button', () => ({
  RepostButton: () => <button type="button">Boost</button>
}))

vi.mock('@/lib/components/posts/actions/like-button', () => ({
  LikeButton: () => <button type="button">Like</button>
}))

vi.mock('@/lib/components/posts/actions/bookmark-button', () => ({
  BookmarkButton: () => <button type="button">Bookmark</button>
}))

// Flattened rather than driven as a real Radix menu; see MockPostMenu.
vi.mock('@/lib/components/posts/actions/post-menu', async () => ({
  PostMenu: (await import('./FitnessStatusDetail.mocks')).MockPostMenu
}))

// Stubbed rather than rendered: this page only has to forward the right props
// to it. Where each of the three renderings actually goes is asserted in
// `lib/components/posts/BrandedDeviceLink.test.tsx`.
vi.mock('@/lib/components/posts/BrandedDeviceLink', async () => ({
  BrandedDeviceLink: (await import('./FitnessStatusDetail.mocks'))
    .MockBrandedDeviceLink
}))

describe('FitnessStatusDetail', () => {
  beforeEach(() => {
    resetFitnessStatusDetailMocks()
  })

  describe('action row', () => {
    it('renders the shared post action row rather than a page-specific one', () => {
      renderDetail()

      // The shared `Actions` row: same controls, same order, same spacing as
      // every other surface. A hand-rolled row here is how this page drifted
      // into a right-packed cluster with its own gaps.
      const actions = screen.getByRole('group', { name: 'Post actions' })
      expect(
        within(actions)
          .getAllByRole('button')
          .map((button) => button.textContent)
      ).toEqual(['Reply', 'Boost', 'Like', 'Bookmark', '', 'More'])
      // This page passes `fullBleed={false}`: the card footer's own padding
      // already puts the row at the status's left edge, so the avatar-column
      // pull (`-ml-13`) would drag it outside the card, and `mt-3` rides along
      // with that pull. One assertion each, since `.not.toHaveClass(a, b)`
      // passes when EITHER class is missing.
      expect(actions).not.toHaveClass('-ml-13')
      expect(actions).not.toHaveClass('mt-3')
    })

    it('renders no action row for a logged-out reader', () => {
      renderDetail({ currentActor: null })

      expect(
        screen.queryByRole('group', { name: 'Post actions' })
      ).not.toBeInTheDocument()
    })
  })

  // Two bugs, one defect: the header card clipped for its rounded corners, and
  // the action row's error tooltips and its edit-history panel are the overlays
  // that do not portal. The tooltips hang `top-full` a couple of pixels under
  // the row, which is itself ~10px above the card's bottom border, so a failed
  // bookmark/like/reaction showed the user an unreadable sliver at every
  // breakpoint. The edit-history panel opens upward from the same row
  // (`bottom-full`, ~360px) over a card body only ~230px tall, so its own
  // header, close button and newest revisions were sliced off on desktop.
  describe('post overlays anchored to the action row', () => {
    const headerCard = () =>
      screen
        .getByRole('group', { name: 'Post actions' })
        .closest('[data-slot="fitness-card"]') as HTMLElement

    it('leaves no clipping ancestor between the action row and the card', () => {
      renderDetail()

      const card = headerCard()
      // Walk the whole chain rather than only checking the card: the overlays
      // are positioned against the row, so anything from the row up to and
      // including the card cuts them off just as effectively — and collect the
      // offenders so a failure names the element that clips. Matching on the
      // `overflow-` prefix rather than `overflow-hidden` alone, the way
      // `page.layout.test.tsx` does for the card outside this one:
      // `overflow-x-hidden` forces the computed `overflow-y` to `auto`, which
      // re-clips the panel vertically. Nothing here needs any of them, so
      // allowing none is the simplest honest guard.
      const clipping: string[] = []
      for (
        let node: HTMLElement | null = screen.getByRole('group', {
          name: 'Post actions'
        });
        node && node !== card.parentElement;
        node = node.parentElement
      ) {
        clipping.push(
          ...Array.from(node.classList).filter((name) =>
            name.startsWith('overflow-')
          )
        )
      }

      expect(clipping).toEqual([])
    })

    it('renders the edit-history panel inside the card that used to clip it', () => {
      renderDetail({
        status: buildStatus({
          edits: [
            {
              text: 'Sunset loop, take one',
              createdAt: Date.parse('2026-05-27T10:45:00Z')
            }
          ]
        })
      })

      fireEvent.click(
        screen.getByRole('button', { name: 'Show edit history, 1 edit' })
      )

      const panel = screen.getByRole('region', { name: 'Edit history' })
      // Unlike the reaction picker and the ⋯ popover, this panel has no portal
      // of its own — it stays a descendant of the card and depends entirely on
      // the card not clipping.
      expect(headerCard()).toContainElement(panel)
    })
  })

  describe('reactions', () => {
    // This page lays out its own card instead of going through `Posts`, so it
    // has to place the chip row itself and hand the same state to the shared
    // `Actions` row — a fitness post is the one surface where losing either
    // half means an existing reaction is invisible or a new one cannot be
    // added.
    it('renders the reaction chips above the action row', () => {
      renderDetail({ status: buildReactedStatus() })

      expect(
        screen.getByLabelText('Add \u{1F525} reaction, 3')
      ).toHaveTextContent('3')
    })

    it('places the chips in the card body under the stats, not in the action strip', () => {
      renderDetail({ status: buildReactedStatus() })

      // Anchored on the stat strip's own wrapper rather than the chips' parent,
      // so wrapping the chips in one more div doesn't fail this. The `\@` is
      // CSS escaping for Tailwind's `@container` class, not a typo.
      const cardBody = screen.getByText('Distance').closest('div.\\@container')
        ?.parentElement as HTMLElement
      expect(cardBody).toContainElement(screen.getByTestId('reaction-chips'))
      expect(cardBody).not.toContainElement(
        screen.getByRole('group', { name: 'Post actions' })
      )
    })

    it('offers the picker trigger in its action row', () => {
      renderDetail({ status: buildReactedStatus() })

      expect(
        screen.getByRole('button', { name: 'Add reaction, 3 reactions' })
      ).toBeInTheDocument()
    })

    it('leaves a logged-out reader the chips without a way to react', () => {
      renderDetail({ currentActor: null, status: buildReactedStatus() })

      expect(
        screen.getByRole('img', { name: '\u{1F525} reaction, 3' })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /^Add reaction/ })
      ).not.toBeInTheDocument()
    })

    it('renders no chip row on a post nobody has reacted to', () => {
      renderDetail()

      // The wrapper, not the chips: `ReactionRow` already renders nothing at
      // zero reactions, so an ungated wrapper leaves a bare `border-t` rule
      // with its padding under it — which no chip query can see.
      expect(screen.queryByTestId('reaction-chips')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Add reaction' })
      ).toBeInTheDocument()
    })
  })

  describe('source file link', () => {
    // The raw upload carries the whole track, including the ends a privacy
    // location trims off the map and the route data, so
    // `GET /api/v1/fitness-files/:id` is owner-only and the link has to match.
    it('offers the owner a link to the source file', async () => {
      renderDetail()

      const link = await screen.findByRole('link', { name: /ride\.fit/ })
      expect(link).toHaveAttribute('href', '/api/v1/fitness-files/fit-1')
    })

    it.each([
      {
        description: 'withholds the download from a signed-in viewer',
        currentActor: notMe
      },
      {
        description: 'withholds the download from a logged-out reader',
        currentActor: null
      }
    ])(
      '$description',
      async ({ currentActor }: { currentActor: ActorProfile | null }) => {
        renderDetail({ currentActor })

        // The name still shows — it is the label saying which file this panel
        // describes, and with several attached it is what the selector switches
        // between. Only the anchor goes, because the endpoint 404s for them.
        await waitFor(() =>
          expect(screen.getByText('ride.fit')).toBeInTheDocument()
        )
        expect(
          screen.queryByRole('link', { name: /ride\.fit/ })
        ).not.toBeInTheDocument()
      }
    )

    it('keeps the action row for a logged-out reader', async () => {
      // The footer that holds the link also holds the shared `<Actions>`, and
      // its gate used to be `sourceHref || currentActor` — which was always true
      // because a fitness post always had a source href. Keying that gate on
      // ownership would have taken the actions away from every logged-out
      // reader along with the link.
      renderDetail({ currentActor: null, status: buildReactedStatus() })

      expect(
        await screen.findByRole('img', { name: '\u{1F525} reaction, 3' })
      ).toBeInTheDocument()
    })
  })

  describe('editing', () => {
    it('offers the owner Edit and Quote in the post menu, like every other surface', async () => {
      renderDetail()

      // The gap this closes: this page used to pass neither `editable` nor
      // `onQuote`, so a fitness activity was the one post its own author could
      // not edit from its own page.
      expect(
        await screen.findByRole('menuitem', { name: 'Edit post' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('menuitem', { name: 'Quote post' })
      ).toBeInTheDocument()
    })

    it('offers no Edit on someone else’s activity', async () => {
      renderDetail({ currentActor: notMe })

      // Quote is still there — anyone may quote a post they can see — but only
      // the author edits.
      expect(
        await screen.findByRole('menuitem', { name: 'Quote post' })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('menuitem', { name: 'Edit post' })
      ).not.toBeInTheDocument()
    })

    it('opens the shared inline composer in edit mode beneath the post', async () => {
      renderDetail()

      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Edit post' })
      )

      const composer = await screen.findByTestId('inline-status-composer')
      expect(composer).toHaveAttribute('data-mode', 'edit')
      // The composer targets this very status, not some unwrapped sibling.
      expect(composer).toHaveAttribute(
        'data-status-id',
        'https://activities.local/users/athlete/statuses/ride-1'
      )
      // Inside the header card, under the action row that opened it — the same
      // relationship `Posts` and `StatusBox` give it.
      expect(
        screen
          .getByRole('group', { name: 'Post actions' })
          .closest('[data-slot="fitness-card"]')
      ).toContainElement(composer)
    })

    it('opens the same composer in quote mode', async () => {
      renderDetail()

      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Quote post' })
      )

      expect(
        await screen.findByTestId('inline-status-composer')
      ).toHaveAttribute('data-mode', 'quote')
    })

    it('closes the composer when the edit is cancelled', async () => {
      renderDetail()

      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Edit post' })
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

      await waitFor(() =>
        expect(
          screen.queryByTestId('inline-status-composer')
        ).not.toBeInTheDocument()
      )
    })

    it('leaves a logged-out reader no composer at all', () => {
      renderDetail({ currentActor: null })

      // `Actions` renders nothing without a viewer, so there is no menu to open
      // one from either.
      expect(screen.queryByTestId('post-menu')).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('inline-status-composer')
      ).not.toBeInTheDocument()
    })
  })
})
