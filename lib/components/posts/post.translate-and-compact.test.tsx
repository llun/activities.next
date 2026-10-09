/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { ReactNode } from 'react'

import {
  bookmarkStatus,
  getTranslationCapability,
  getTranslationLanguages,
  reactToStatus
} from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'

import { Post } from './post'
import { currentTime, status } from './post.testUtils'

vi.mock('./collapsible-content', () => ({
  CollapsibleContent: ({
    children,
    onReadMore
  }: {
    children: ReactNode
    onReadMore?: () => void
  }) => (
    <div data-testid="collapsible-content">
      {children}
      {onReadMore && (
        <button
          type="button"
          data-testid="read-more-button"
          onClick={onReadMore}
        >
          Read full post
        </button>
      )}
    </div>
  )
}))

vi.mock('./poll', () => ({
  Poll: () => null
}))

vi.mock('./attachments', () => ({
  Attachments: () => null
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() })
}))

vi.mock('@/lib/client', () => ({
  bookmarkStatus: vi.fn(),
  undoBookmarkStatus: vi.fn(),
  deleteStatus: vi.fn(),
  likeStatus: vi.fn(),
  undoLikeStatus: vi.fn(),
  repostStatus: vi.fn(),
  undoRepostStatus: vi.fn(),
  updateStatusVisibility: vi.fn(),
  getRelationship: vi.fn().mockResolvedValue(null),
  mute: vi.fn(),
  unmute: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
  createReport: vi.fn(),
  retryFitnessProcessing: vi.fn(),
  getFitnessProcessingState: vi.fn().mockResolvedValue(null),
  getTranslationCapability: vi.fn(),
  getTranslationLanguages: vi.fn(),
  translateStatus: vi.fn(),
  reactToStatus: vi.fn(),
  unreactFromStatus: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  // QuoteCard loads the quoted status itself; a quoting status renders it.
  getStatusById: vi.fn().mockResolvedValue(null)
}))

describe('Post', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Translate gating', () => {
    beforeEach(() => {
      ;(getTranslationCapability as jest.Mock).mockResolvedValue({
        enabled: true,
        defaultLanguage: 'en'
      })
      ;(getTranslationLanguages as jest.Mock).mockResolvedValue({
        th: ['en']
      })
    })

    it('offers Translate when the content-detected language overrides a mislabeled declared language', async () => {
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            language: 'en',
            detectedLanguage: 'th'
          }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(
        await screen.findByRole('button', { name: /Translate from Thai/ })
      ).toBeInTheDocument()
    })

    it('does not offer Translate for a signed-out viewer even with a detected language', async () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            language: 'en',
            detectedLanguage: 'th'
          }}
          onShowAttachment={vi.fn()}
        />
      )

      await waitFor(() =>
        expect(getTranslationCapability).not.toHaveBeenCalled()
      )
      expect(
        screen.queryByRole('button', { name: /Translate/ })
      ).not.toBeInTheDocument()
    })

    it('does not offer Translate when the resolved source matches the viewer default language', async () => {
      ;(getTranslationLanguages as jest.Mock).mockResolvedValue({
        en: ['th']
      })

      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            language: 'th',
            detectedLanguage: 'en'
          }}
          onShowAttachment={vi.fn()}
        />
      )

      await waitFor(() => expect(getTranslationCapability).toHaveBeenCalled())
      expect(
        screen.queryByRole('button', { name: /Translate/ })
      ).not.toBeInTheDocument()
    })
  })

  describe('narrow action row', () => {
    // jsdom has no ResizeObserver and lays nothing out, so stand one in that
    // reports a width the test chooses — the row measures its own container,
    // not the viewport, so this is the only thing that decides compact vs.
    // full. `resizeTo` re-delivers, which is what makes a width *change*
    // (rather than just an initial width) testable.
    let resizeTo: ((width: number) => void) | null = null

    const observeWidth = (width: number) => {
      resizeTo = null
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(
            private readonly callback: (entries: ResizeObserverEntry[]) => void
          ) {}
          observe(target: Element) {
            const emit = (next: number) => {
              this.callback([
                {
                  target,
                  contentRect: { width: next } as DOMRectReadOnly
                } as ResizeObserverEntry
              ])
            }
            resizeTo = emit
            emit(width)
          }
          unobserve() {}
          disconnect() {}
        }
      )
    }

    const openMenu = async () => {
      fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), {
        key: 'ArrowDown'
      })
      return screen.findByRole('menu')
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('keeps every action in the row when the post is wide enough', () => {
      observeWidth(900)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={status}
          onShowAttachment={vi.fn()}
        />
      )

      expect(
        within(screen.getByRole('group', { name: 'Post actions' }))
          .getAllByRole('button')
          .map((button) => button.getAttribute('aria-label'))
      ).toEqual([
        'Reply to post',
        'Repost',
        'Like',
        'Bookmark',
        'Add reaction',
        'More actions'
      ])
    })

    it('pulls the action row back over the avatar column by default', () => {
      observeWidth(900)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={{
            ...status,
            reactions: [
              { name: '🔥', count: 2, me: false, url: null, static_url: null }
            ]
          }}
          onShowAttachment={vi.fn()}
        />
      )

      // Neither class is observable in jsdom layout, so pin them: `-ml-13`
      // pulls the row back to the post's left edge and `mt-3` rides along with
      // it in `Actions`' `fullBleed` default. One assertion each.
      const actions = screen.getByRole('group', { name: 'Post actions' })
      expect(actions).toHaveClass('-ml-13')
      expect(actions).toHaveClass('mt-3')
      // The reaction chips go full-bleed with the action row, or they line up
      // with nothing.
      expect(
        screen.getByLabelText('Add 🔥 reaction, 2').parentElement
      ).toHaveClass('-ml-13')
    })

    it('hands bookmark and react to the overflow menu when the post is narrow', async () => {
      observeWidth(320)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={status}
          onShowAttachment={vi.fn()}
        />
      )

      // Reply / boost / like keep their place; the two that would not fit at a
      // comfortable hit size move into the menu that is already there.
      expect(
        within(screen.getByRole('group', { name: 'Post actions' }))
          .getAllByRole('button')
          .map((button) => button.getAttribute('aria-label'))
      ).toEqual(['Reply to post', 'Repost', 'Like', 'More actions'])

      // A control that moves into the menu must leave no wrapper behind. The
      // row is a `gap-1` flex, so a zero-width leftover still claims a gap of
      // its own and shifts everything after it — which the `ml-auto` on `⋯`
      // hides in exactly this render (nothing else follows it) and stops
      // hiding the moment an edit-history button does.
      expect(
        screen.getByRole('group', { name: 'Post actions' }).children
      ).toHaveLength(4)

      const menu = await openMenu()
      expect(
        within(menu).getByRole('menuitem', { name: 'React to post' })
      ).toBeInTheDocument()
      expect(
        within(menu).getByRole('menuitem', { name: 'Bookmark' })
      ).toBeInTheDocument()
    })

    it('opens the reaction picker from the overflow menu', async () => {
      observeWidth(320)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={status}
          onShowAttachment={vi.fn()}
        />
      )

      const menu = await openMenu()
      fireEvent.click(
        within(menu).getByRole('menuitem', { name: 'React to post' })
      )

      expect(
        await screen.findByRole('dialog', { name: 'Choose a reaction' })
      ).toBeInTheDocument()
      // The whole point of `deferUntilClosed`: without it Radix restores focus
      // to the ⋯ trigger as the menu unmounts, which lands after the panel has
      // taken it and leaves a keyboard user back at the top of the document.
      await waitFor(() =>
        expect(screen.getByLabelText('Search emoji')).toHaveFocus()
      )
    })

    it('surfaces a failed reaction even though the trigger is in the menu', async () => {
      observeWidth(320)
      ;(reactToStatus as jest.Mock).mockResolvedValue({
        ok: false,
        error: 'You can only add 8 reactions to a post.'
      })
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={{
            ...status,
            reactions: [
              { name: '🔥', count: 2, me: false, url: null, static_url: null }
            ]
          }}
          onShowAttachment={vi.fn()}
        />
      )

      fireEvent.click(screen.getByLabelText('Add 🔥 reaction, 2'))

      // The button that normally renders this error is not in the row at this
      // width, so without an explicit home the refusal would be invisible.
      expect(await screen.findByTestId('reaction-error')).toHaveTextContent(
        'You can only add 8 reactions to a post.'
      )
    })

    it('surfaces a failed bookmark even though the button is in the menu', async () => {
      observeWidth(320)
      ;(bookmarkStatus as jest.Mock).mockResolvedValue(false)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={status}
          onShowAttachment={vi.fn()}
        />
      )

      const menu = await openMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Bookmark' }))

      expect(await screen.findByTestId('bookmark-error')).toHaveTextContent(
        'Failed to bookmark post. Please try again.'
      )
    })

    it('closes an open picker onto the new trigger when the row turns compact', async () => {
      observeWidth(900)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={status}
          onShowAttachment={vi.fn()}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }))
      await screen.findByRole('dialog', { name: 'Choose a reaction' })

      act(() => resizeTo?.(320))

      // The panel is placed from its anchor's rect once, and the anchor it was
      // measured against has just unmounted — so leaving it open would strand
      // it over empty space. Focus has to follow it somewhere deliberate, not
      // fall back to <body> with the panel gone.
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Choose a reaction' })
        ).not.toBeInTheDocument()
      )
      expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus()
    })

    it('disables the menu items whose write is already in flight', async () => {
      observeWidth(320)
      const bookmark = createDeferred<boolean>()
      ;(bookmarkStatus as jest.Mock).mockReturnValue(bookmark.promise)
      ;(reactToStatus as jest.Mock).mockReturnValue(new Promise(() => {}))
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={{
            ...status,
            reactions: [
              { name: '🔥', count: 2, me: false, url: null, static_url: null }
            ]
          }}
          onShowAttachment={vi.fn()}
        />
      )

      fireEvent.click(screen.getByLabelText('Add 🔥 reaction, 2'))
      fireEvent.click(
        within(await openMenu()).getByRole('menuitem', {
          name: 'Bookmark'
        })
      )
      await waitFor(() => expect(bookmarkStatus).toHaveBeenCalledTimes(1))

      // Unlike the buttons they replace, menu items carry no busy styling, so
      // without this a tap during a pending write is swallowed by the
      // single-flight guard with nothing on screen to explain it.
      const menu = await openMenu()
      expect(
        within(menu).getByRole('menuitem', { name: 'React to post' })
      ).toHaveAttribute('data-disabled')
      expect(
        within(menu).getByRole('menuitem', { name: 'Bookmark' })
      ).toHaveAttribute('data-disabled')

      // …and comes back once its own write settles. Asserted on the still-open
      // menu: Radix `aria-hidden`s the rest of the document while it is up, so
      // reopening would not find the ⋯ trigger.
      await act(async () => {
        bookmark.resolve(true)
      })
      expect(
        within(menu).getByRole('menuitem', { name: 'Remove bookmark' })
      ).not.toHaveAttribute('data-disabled')
      // The reaction write is still in flight, so that one stays disabled —
      // the two are independent, not one shared busy flag.
      expect(
        within(menu).getByRole('menuitem', { name: 'React to post' })
      ).toHaveAttribute('data-disabled')
    })

    it('stacks a bookmark and a reaction failure instead of overlapping them', async () => {
      observeWidth(320)
      ;(bookmarkStatus as jest.Mock).mockResolvedValue(false)
      ;(reactToStatus as jest.Mock).mockResolvedValue({ ok: false })
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={{
            ...status,
            reactions: [
              { name: '🔥', count: 2, me: false, url: null, static_url: null }
            ]
          }}
          onShowAttachment={vi.fn()}
        />
      )

      const menu = await openMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Bookmark' }))
      const bookmarkError = await screen.findByTestId('bookmark-error')
      fireEvent.click(screen.getByLabelText('Add 🔥 reaction, 2'))
      const reactionError = await screen.findByTestId('reaction-error')

      // Both writes are independent, so both can fail inside one dismiss
      // window. Sharing a parent is not the point and would have been true of
      // the broken version too — what matters is that neither positions
      // itself: individually anchored they were two opaque boxes at the same
      // `right-0 top-full`, one hiding the other. They are laid out by one
      // stack instead.
      expect(bookmarkError).not.toHaveClass('absolute')
      expect(reactionError).not.toHaveClass('absolute')
      expect(bookmarkError.parentElement).toBe(reactionError.parentElement)
      expect(bookmarkError.parentElement).toHaveClass('absolute', 'flex-col')
    })

    it('keeps the bookmark it took while wide when the row turns compact', async () => {
      observeWidth(900)
      ;(bookmarkStatus as jest.Mock).mockResolvedValue(true)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={status}
          onShowAttachment={vi.fn()}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Bookmark' }))
      await screen.findByRole('button', { name: 'Remove bookmark' })

      act(() => resizeTo?.(320))

      // This is the whole reason the bookmark state sits in the row rather than
      // in the button: the button unmounts here, and a second copy of the state
      // in the menu item would offer to bookmark a post that already is one.
      expect(
        within(await openMenu()).getByRole('menuitem', {
          name: 'Remove bookmark'
        })
      ).toBeInTheDocument()
    })

    it('bookmarks from the overflow menu', async () => {
      observeWidth(320)
      ;(bookmarkStatus as jest.Mock).mockResolvedValue(true)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={status}
          onShowAttachment={vi.fn()}
        />
      )

      const menu = await openMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Bookmark' }))

      await waitFor(() =>
        expect(bookmarkStatus).toHaveBeenCalledWith({ statusId: status.id })
      )
      // The state lives in the row, so reopening the menu offers the undo —
      // it is not a second, independent copy of the bookmark.
      expect(
        within(await openMenu()).getByRole('menuitem', {
          name: 'Remove bookmark'
        })
      ).toBeInTheDocument()
    })
  })
})
