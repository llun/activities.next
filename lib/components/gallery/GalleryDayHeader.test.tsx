/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GalleryDayHeader } from '@/lib/components/gallery/GalleryDayHeader'
import { breakoutStyle } from '@/lib/components/layout/chromeLayout'
import type { GalleryDayStats } from '@/lib/services/gallery/galleryEntities'

const DAY = '2025-10-04'

const baseProps = {
  dayKey: DAY,
  loadedCount: 14,
  loadedInAlbum: 0,
  picked: 2,
  selecting: true,
  hasAlbum: false,
  room: null as number | null,
  onSelectDay: vi.fn(),
  onDeselectDay: vi.fn()
}

const stats = (overrides: Partial<GalleryDayStats> = {}): GalleryDayStats => ({
  count: 14,
  inAlbum: 0,
  placeName: 'Box Hill, Surrey',
  activity: null,
  ...overrides
})

describe('GalleryDayHeader', () => {
  it('renders the heading at the requested level', () => {
    const { rerender } = render(<GalleryDayHeader {...baseProps} as="h3" />)

    const heading = screen.getByRole('heading')
    expect(heading.tagName).toBe('H3')
    expect(heading).toHaveTextContent('Sat 4 Oct 2025')
    expect(heading).toHaveTextContent('Sat 4 Oct')

    rerender(<GalleryDayHeader {...baseProps} as="h2" />)
    expect(screen.getByRole('heading').tagName).toBe('H2')
  })

  it('prefers server stats over the loaded counts', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({ count: 27, placeName: 'Skomer Island', inAlbum: 3 })}
      />
    )

    expect(
      screen.getByText('Skomer Island · 27 photos · 2 picked · 3 in album')
    ).toBeInTheDocument()
  })

  it('falls back to the loaded counts when stats are absent', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        loadedCount={9}
        loadedInAlbum={4}
        picked={1}
      />
    )

    expect(
      screen.getByText('9 photos · 1 picked · 4 in album')
    ).toBeInTheDocument()
  })

  it('renders the activity chip with an aria-hidden emoji', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({
          activity: {
            id: 'activity-1',
            activityType: 'ride',
            distanceMeters: 64200
          }
        })}
      />
    )

    // Both chips keep the emoji and the title.
    const emojis = screen.getAllByText('🚴')
    expect(emojis).toHaveLength(2)
    for (const emoji of emojis) {
      expect(emoji).toHaveAttribute('aria-hidden', 'true')
      expect(emoji.parentElement).toHaveTextContent('🚴 Ride · 64.2 km')
    }
    expect(emojis[0].parentElement).toHaveClass('hidden', 'sm:inline-flex')
  })

  it('shows the emoji, activity name and distance below sm', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({
          activity: {
            id: 'activity-1',
            activityType: 'ride',
            distanceMeters: 64200
          }
        })}
      />
    )

    const phoneChip = screen
      .getAllByText('🚴')
      .map((emoji) => emoji.parentElement)
      .find((chip) => chip?.className.includes('sm:hidden'))
    // Below sm the chip keeps the compact visible activity name beside the
    // emoji, so same-emoji activity types stay distinguishable.
    expect(phoneChip).toHaveTextContent('🚴 Ride · 64.2 km')
    expect(phoneChip).toHaveClass('sm:hidden', 'min-w-0', 'truncate')
    expect(phoneChip?.querySelector('.sr-only')).toBeNull()
  })

  it('shows the formatted activity title on phones when there is no emoji', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({
          activity: {
            id: 'activity-1',
            activityType: 'swim',
            distanceMeters: 1500
          }
        })}
      />
    )

    const phoneChip = screen
      .getAllByText('Swim · 1.50 km')
      .find((chip) => chip.className.includes('sm:hidden'))

    expect(phoneChip).toHaveTextContent('Swim · 1.50 km')
    expect(phoneChip).toHaveClass('min-w-0', 'truncate')
  })

  it('shows the emoji and the activity name below sm when there is no distance', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({
          activity: {
            id: 'activity-1',
            activityType: 'ride',
            distanceMeters: null
          }
        })}
      />
    )

    const phoneChip = screen
      .getAllByText('🚴')
      .map((emoji) => emoji.parentElement)
      .find((chip) => chip?.className.includes('sm:hidden'))
    expect(phoneChip).toHaveTextContent('🚴 Ride')
  })

  it('keeps the phone meta to count and picked, truncating beside the chip', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({
          activity: {
            id: 'activity-1',
            activityType: 'ride',
            distanceMeters: 64200
          }
        })}
      />
    )

    const meta = screen.getByText('14 · 2 picked')
    expect(meta).toHaveClass('sm:hidden', 'whitespace-nowrap')
    // Below sm the meta sits on row 2, where the line may wrap; the
    // phone meta cannot wrap, so it truncates via the min-w-0.
    expect(meta.parentElement).toHaveClass('min-w-0', 'truncate')
    expect(
      screen.getByText('Box Hill, Surrey · 14 photos · 2 picked')
    ).toHaveClass('max-sm:hidden')
    const phoneChip = screen
      .getAllByText('🚴')
      .map((emoji) => emoji.parentElement)
      .find((chip) => chip?.className.includes('sm:hidden'))
    expect(phoneChip).toHaveClass('sm:hidden', 'min-w-0', 'truncate')
  })

  it('renders the two-row phone layout with the button beside the heading', () => {
    render(<GalleryDayHeader {...baseProps} />)

    const heading = screen.getByRole('heading')
    const button = screen.getByRole('button', {
      name: 'Select 12 more, Sat 4 Oct 2025'
    })
    const root = heading.parentElement

    // Below sm the header is a two-row grid; at sm and up it stays the
    // same single flex row as before.
    expect(root).toHaveClass(
      'sticky',
      'z-10',
      'max-sm:grid',
      'max-sm:grid-cols-[minmax(0,1fr)_auto]',
      'sm:flex',
      'sm:items-center',
      'sm:gap-2'
    )
    // Row 1: the heading (min-w-0, truncating as a safety) and the
    // Select day button (shrink-0, never clipped) as siblings.
    expect(button.parentElement).toBe(root)
    expect(heading).toHaveClass('max-sm:min-w-0', 'max-sm:truncate')
    expect(button).toHaveClass(
      'shrink-0',
      'max-sm:col-start-2',
      'max-sm:row-start-1'
    )
  })

  it('puts the meta line and the activity chip on row 2 below sm', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({
          activity: {
            id: 'activity-1',
            activityType: 'ride',
            distanceMeters: 64200
          }
        })}
      />
    )

    const meta = screen.getByText('14 · 2 picked')
    const row2 = meta.parentElement?.parentElement
    expect(row2).not.toBeNull()
    // Row 2 spans both grid columns, wraps when needed, and flattens
    // back into the one-row layout at sm and up.
    expect(row2).toHaveClass(
      'max-sm:col-span-2',
      'max-sm:row-start-2',
      'max-sm:flex-wrap',
      'max-sm:min-w-0',
      'sm:contents'
    )
    // The activity chip sits beside the meta on row 2, truncating via
    // min-w-0 when it cannot wrap.
    const phoneChip = screen
      .getAllByText('🚴')
      .map((emoji) => emoji.parentElement)
      .find((chip) => chip?.className.includes('sm:hidden'))
    expect(phoneChip?.parentElement).toBe(row2)
    expect(phoneChip).toHaveClass('sm:hidden', 'min-w-0', 'truncate')
  })

  it('renders no chip when the day has no activity', () => {
    render(<GalleryDayHeader {...baseProps} stats={stats()} />)

    expect(screen.queryByText('🚴')).toBeNull()
  })

  it('labels the button per the action and includes the date in its name', () => {
    render(<GalleryDayHeader {...baseProps} />)

    const button = screen.getByRole('button', {
      name: 'Select 12 more, Sat 4 Oct 2025'
    })
    expect(button).toHaveTextContent('Select 12 more')
    expect(button).toHaveTextContent('Select 12')
    expect(button).toBeEnabled()
  })

  it('calls onSelectDay with the take', () => {
    const onSelectDay = vi.fn()
    render(<GalleryDayHeader {...baseProps} onSelectDay={onSelectDay} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Select 12 more, Sat 4 Oct 2025' })
    )

    expect(onSelectDay).toHaveBeenCalledWith(DAY, 12)
  })

  it('calls onDeselectDay when every pickable photo is picked', () => {
    const onDeselectDay = vi.fn()
    render(
      <GalleryDayHeader
        {...baseProps}
        picked={14}
        onDeselectDay={onDeselectDay}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Deselect day, Sat 4 Oct 2025' })
    )

    expect(onDeselectDay).toHaveBeenCalledWith(DAY)
  })

  it('keeps All in album focusable and aria-disabled', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({ count: 8, inAlbum: 8 })}
        hasAlbum
        picked={0}
      />
    )

    const button = screen.getByRole('button', {
      name: 'All in album, Sat 4 Oct 2025'
    })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveClass(
      'aria-disabled:pointer-events-none',
      'aria-disabled:opacity-50'
    )
  })

  it('keeps Album full focusable and aria-disabled', () => {
    render(<GalleryDayHeader {...baseProps} room={0} />)

    const button = screen.getByRole('button', {
      name: 'Album full, Sat 4 Oct 2025'
    })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveClass(
      'aria-disabled:pointer-events-none',
      'aria-disabled:opacity-50'
    )
  })

  it('shows the room-left take', () => {
    render(
      <GalleryDayHeader {...baseProps} loadedCount={118} picked={0} room={40} />
    )

    const button = screen.getByRole('button', {
      name: 'Select 40 (room left), Sat 4 Oct 2025'
    })
    expect(button).toHaveTextContent('Select 40 (room left)')
    expect(button).toHaveTextContent('Select 40')
  })

  it('keeps a focused Select day button focused and guarded while busy', () => {
    const onSelectDay = vi.fn()
    const { rerender } = render(
      <GalleryDayHeader {...baseProps} onSelectDay={onSelectDay} />
    )

    const button = screen.getByRole('button', {
      name: 'Select 12 more, Sat 4 Oct 2025'
    })
    button.focus()

    rerender(
      <GalleryDayHeader
        {...baseProps}
        busyKey={DAY}
        onSelectDay={onSelectDay}
      />
    )

    expect(button).toHaveTextContent('Selecting…')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(document.activeElement).toBe(button)

    fireEvent.click(button)
    expect(onSelectDay).not.toHaveBeenCalled()
  })

  it('shows the fetched count while busy once the read has ids', () => {
    render(<GalleryDayHeader {...baseProps} busyKey={DAY} busyCount={2000} />)

    const button = screen.getByRole('button', {
      name: 'Select 12 more, Sat 4 Oct 2025'
    })
    expect(button).toHaveTextContent('Selecting… 2,000')
    expect(button).not.toHaveTextContent('Select 12 more')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
  })

  it('labels the busy state Deselecting while a Deselect day read runs', () => {
    const { rerender } = render(
      <GalleryDayHeader {...baseProps} picked={14} busyKey={DAY} />
    )

    // Every pickable photo is picked, so the pending action is a deselect.
    const button = screen.getByRole('button', {
      name: 'Deselect day, Sat 4 Oct 2025'
    })
    expect(button).toHaveTextContent('Deselecting…')
    expect(button).not.toHaveTextContent('Selecting…')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()

    rerender(
      <GalleryDayHeader
        {...baseProps}
        picked={14}
        busyKey={DAY}
        busyCount={2000}
      />
    )
    expect(button).toHaveTextContent('Deselecting… 2,000')
    expect(button).not.toHaveTextContent('Selecting…')
  })

  it('disables other days while a day request is busy', () => {
    render(
      <GalleryDayHeader {...baseProps} dayKey="2025-10-03" busyKey={DAY} />
    )

    const button = screen.getByRole('button', {
      name: 'Select 12 more, Fri 3 Oct 2025'
    })
    expect(button).toHaveTextContent('Select 12 more')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
  })

  it('uses native disabled only while the host is saving', () => {
    render(<GalleryDayHeader {...baseProps} disabled />)

    const button = screen.getByRole('button', {
      name: 'Select 12 more, Sat 4 Oct 2025'
    })
    expect(button).toBeDisabled()
    expect(button).not.toHaveAttribute('aria-disabled')
  })

  it('keeps the one-row phone layout when there is no action button', () => {
    const { rerender } = render(
      <GalleryDayHeader {...baseProps} selecting={false} />
    )

    const heading = screen.getByRole('heading')
    const root = heading.parentElement
    expect(root).toHaveClass('flex', 'items-center', 'gap-2')
    expect(root).not.toHaveClass('max-sm:grid')
    expect(heading).not.toHaveClass('max-sm:truncate')

    // The meta line and the activity chip stay flat siblings of the
    // heading, and the meta does not shrink below sm.
    const meta = screen.getByText('14 photos')
    const p = meta.parentElement
    expect(p).toHaveClass('max-sm:shrink-0')
    const row = p?.parentElement
    expect(row).toHaveClass('contents')
    expect(row).not.toHaveClass('max-sm:flex-wrap')

    // The Undated day has no action either, even while selecting.
    rerender(<GalleryDayHeader {...baseProps} dayKey="undated" />)
    expect(screen.getByRole('heading').parentElement).not.toHaveClass(
      'max-sm:grid'
    )
  })

  it('renders no button when not selecting', () => {
    render(<GalleryDayHeader {...baseProps} selecting={false} />)

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders no button for the undated key', () => {
    render(<GalleryDayHeader {...baseProps} dayKey="undated" />)

    expect(screen.getByRole('heading')).toHaveTextContent('No date')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('passes the host className through', () => {
    render(<GalleryDayHeader {...baseProps} className="top-0 bg-background" />)

    expect(screen.getByRole('heading').parentElement).toHaveClass(
      'top-0',
      'bg-background',
      'sticky',
      'z-10'
    )
  })
})

describe('GalleryDayHeader page surface', () => {
  class MockIntersectionObserver implements IntersectionObserver {
    static instances: MockIntersectionObserver[] = []
    callback: IntersectionObserverCallback
    root: Document | Element | null = null
    rootMargin = ''
    scrollMargin = ''
    thresholds: number[] = []

    constructor(
      callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit
    ) {
      this.callback = callback
      this.rootMargin = (options?.rootMargin as string) ?? ''
      MockIntersectionObserver.instances.push(this)
    }

    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }

  // Fires an entry for a sentinel whose box top sits at `boundingTop` in a
  // root whose top edge sits at `rootTop` (the shrunken viewport).
  const fireEntry = (
    observer: MockIntersectionObserver,
    boundingTop: number,
    rootTop: number,
    isIntersecting = false
  ) => {
    act(() => {
      observer.callback(
        [
          {
            isIntersecting,
            boundingClientRect: { top: boundingTop },
            rootBounds: { top: rootTop }
          } as unknown as IntersectionObserverEntry
        ],
        observer as unknown as IntersectionObserver
      )
    })
  }

  // Stubs the observer for the duration of `run`, awaiting it first: an
  // async run must not outlive the stub.
  const withMockObserver = async (run: () => void | Promise<void>) => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    MockIntersectionObserver.instances = []
    try {
      await run()
    } finally {
      vi.unstubAllGlobals()
    }
  }

  // The page surface wraps the row in a breakout box: the sticky element the
  // observer watches is the heading's sticky ancestor, not the row itself.
  const pageHeader = () =>
    screen.getByRole('heading').closest('div.sticky') as HTMLElement

  it('is transparent at rest with a sentinel above it', () => {
    const { container } = render(
      <GalleryDayHeader {...baseProps} surface="page" />
    )

    const header = pageHeader()
    expect(header).not.toHaveClass('bg-background')
    expect(header).not.toHaveClass('bg-surface-chrome')
    expect(header).not.toHaveClass('border-b')
    expect(header).not.toHaveAttribute('data-stuck')
    // The row inside the breakout box re-centres at max-w-content with the
    // column's padding, so the text stays aligned with the tiles.
    const row = screen.getByRole('heading').parentElement as HTMLElement
    expect(row).toHaveClass('mx-auto', 'max-w-content', 'px-4')

    const sentinel = container.firstElementChild as HTMLElement
    expect(sentinel).toHaveAttribute('aria-hidden', 'true')
    expect(sentinel).not.toBe(header)
  })

  it('breaks the stuck strip out to the pane like the title band', () => {
    const { unmount } = render(
      <GalleryDayHeader {...baseProps} surface="page" />
    )

    // The same mechanism the Gallery title band uses: the sticky box carries
    // breakoutStyle, so its background spans the content pane edge to edge
    // instead of stopping 16px past the photo column.
    const header = pageHeader()
    expect(header.style.marginLeft).toBe(breakoutStyle.marginLeft)
    expect(header.style.marginRight).toBe(breakoutStyle.marginRight)
    unmount()

    // The dialog surface (the album picker) keeps its own box: no breakout.
    render(<GalleryDayHeader {...baseProps} />)
    const dialog = screen.getByRole('heading').parentElement as HTMLElement
    expect(dialog.style.marginLeft).toBe('')
    expect(dialog.style.marginRight).toBe('')
    expect(dialog).toHaveClass('sticky')
  })

  it('gains the chrome surface and a 0px hairline shadow only while stuck', async () => {
    await withMockObserver(() => {
      const { container } = render(
        <GalleryDayHeader {...baseProps} surface="page" />
      )

      const header = pageHeader()
      const sentinel = container.firstElementChild as HTMLElement
      const observer = MockIntersectionObserver.instances.at(-1)
      expect(observer).toBeDefined()
      expect(observer?.observe).toHaveBeenCalledWith(sentinel)

      // The sentinel has scrolled behind the root's top edge.
      fireEntry(observer!, -1, 0)
      expect(header).toHaveAttribute('data-stuck', 'true')
      expect(header).toHaveClass(
        'data-[stuck]:bg-surface-chrome',
        'data-[stuck]:backdrop-blur'
      )
      // The hairline is a shadow, not a border: pinning must not shift
      // the tiles by growing the header.
      expect(header).toHaveClass('data-[stuck]:shadow-[0_1px_0_var(--border)]')
      expect(header).not.toHaveClass('data-[stuck]:border-b')

      fireEntry(observer!, 10, 0)
      expect(header).not.toHaveAttribute('data-stuck')
      expect(header).not.toHaveClass('bg-surface-chrome')
    })
  })

  it('never sticks without an IntersectionObserver', () => {
    // jsdom ships no IntersectionObserver: the header stays transparent
    // instead of guessing or crashing.
    const { container } = render(
      <GalleryDayHeader {...baseProps} surface="page" />
    )

    expect(container.querySelector('[data-stuck]')).toBeNull()
    expect(pageHeader()).not.toHaveClass('bg-surface-chrome')
  })

  it('marks stuck when the sentinel has crossed above the root top', async () => {
    await withMockObserver(() => {
      render(<GalleryDayHeader {...baseProps} surface="page" />)

      const header = pageHeader()
      const observer = MockIntersectionObserver.instances.at(-1)!
      expect(observer).toBeDefined()

      fireEntry(observer, -1, 96)
      expect(header).toHaveAttribute('data-stuck', 'true')

      // Back below the root's top edge: not stuck again.
      fireEntry(observer, 120, 96)
      expect(header).not.toHaveAttribute('data-stuck')
    })
  })

  it('stays unstuck while the sentinel is still below the viewport', async () => {
    await withMockObserver(() => {
      render(<GalleryDayHeader {...baseProps} surface="page" />)

      const header = pageHeader()
      const observer = MockIntersectionObserver.instances.at(-1)!

      // The sentinel has not reached the shrunken viewport yet: the header
      // must not pin just because the entry is not intersecting.
      fireEntry(observer, 400, 96)
      expect(header).not.toHaveAttribute('data-stuck')
    })
  })

  it('stays unstuck while the sentinel straddles the root top', async () => {
    await withMockObserver(() => {
      render(<GalleryDayHeader {...baseProps} surface="page" />)

      const header = pageHeader()
      const observer = MockIntersectionObserver.instances.at(-1)!

      // Scrolling back down, the 1px sentinel can re-enter straddling the
      // root top: intersecting, but its top sits above the edge. The header
      // is back in flow, so it must not stay frosted.
      fireEntry(observer, 95.5, 96, true)
      expect(header).not.toHaveAttribute('data-stuck')
      expect(header).not.toHaveClass('bg-surface-chrome')
    })
  })

  it('cuts the rootMargin by the computed sticky offset', async () => {
    await withMockObserver(() => {
      const realGetComputedStyle = window.getComputedStyle
      vi.spyOn(window, 'getComputedStyle').mockImplementation(((
        element: Element
      ) => {
        if (
          element instanceof HTMLElement &&
          element.className.includes('sticky')
        ) {
          return { top: '79px' } as unknown as CSSStyleDeclaration
        }
        return realGetComputedStyle.call(window, element)
      }) as typeof window.getComputedStyle)

      render(<GalleryDayHeader {...baseProps} surface="page" />)

      const observer = MockIntersectionObserver.instances.at(-1)
      expect(observer).toBeDefined()
      expect(observer?.rootMargin).toBe('-79px 0px 0px 0px')

      vi.restoreAllMocks()
    })
  })

  it('re-creates the observer when the sticky offset may move', async () => {
    await withMockObserver(async () => {
      // jsdom ships no matchMedia: stub one whose matches the test flips to
      // cross md (48rem).
      const mediaListeners = new Set<() => void>()
      const media = {
        matches: false,
        addEventListener: (_type: string, listener: () => void) => {
          mediaListeners.add(listener)
        },
        removeEventListener: (_type: string, listener: () => void) => {
          mediaListeners.delete(listener)
        }
      }
      vi.stubGlobal('matchMedia', () => media)

      const { container } = render(
        <GalleryDayHeader {...baseProps} surface="page" />
      )
      const sentinel = container.firstElementChild as HTMLElement
      expect(MockIntersectionObserver.instances).toHaveLength(1)

      try {
        // --status-strip-h lands in <html>'s style attribute: the observer
        // is re-created so the new offset reaches the rootMargin.
        await act(async () => {
          document.documentElement.style.setProperty('--status-strip-h', '4px')
        })
        expect(MockIntersectionObserver.instances).toHaveLength(2)

        // Crossing md (48rem) moves the offset too.
        media.matches = true
        await act(async () => {
          for (const listener of [...mediaListeners]) listener()
        })
        expect(MockIntersectionObserver.instances).toHaveLength(3)

        // An unrelated <html> style change (the photo viewer's overflow
        // toggle) moves nothing: no observer rebuild.
        await act(async () => {
          document.documentElement.style.overflow = 'hidden'
        })
        expect(MockIntersectionObserver.instances).toHaveLength(3)

        // Every observer watched the sentinel, and the replaced ones were
        // disconnected.
        for (const observer of MockIntersectionObserver.instances) {
          expect(observer.observe).toHaveBeenCalledWith(sentinel)
        }
        expect(
          MockIntersectionObserver.instances[0].disconnect
        ).toHaveBeenCalled()
        expect(
          MockIntersectionObserver.instances[1].disconnect
        ).toHaveBeenCalled()
      } finally {
        await act(async () => {
          document.documentElement.style.removeProperty('--status-strip-h')
          document.documentElement.style.removeProperty('overflow')
        })
      }
    })
  })

  it('shares one MutationObserver across headers and tears it down with the last', () => {
    // A stand-in MutationObserver that counts constructions: the shared
    // store must build exactly one while any header is mounted.
    const instances: Array<{
      observe: ReturnType<typeof vi.fn>
      disconnect: ReturnType<typeof vi.fn>
    }> = []
    class CountingMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(_callback: MutationCallback) {
        instances.push(this)
      }
    }
    vi.stubGlobal('MutationObserver', CountingMutationObserver)

    try {
      const { unmount } = render(
        <>
          <GalleryDayHeader {...baseProps} surface="page" />
          <GalleryDayHeader {...baseProps} dayKey="2025-10-03" surface="page" />
        </>
      )
      // Two headers, one shared <html> watcher.
      expect(instances).toHaveLength(1)
      expect(instances[0].observe).toHaveBeenCalledWith(
        document.documentElement,
        { attributes: true, attributeFilter: ['style'] }
      )

      unmount()
      // The last unmount releases the store, so its watcher disconnects and
      // the next mount builds a fresh one.
      expect(instances[0].disconnect).toHaveBeenCalled()
      render(<GalleryDayHeader {...baseProps} surface="page" />)
      expect(instances).toHaveLength(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('re-reads --status-strip-h from scratch once the store was torn down', async () => {
    await withMockObserver(async () => {
      const first = render(<GalleryDayHeader {...baseProps} surface="page" />)
      await act(async () => {
        document.documentElement.style.setProperty('--status-strip-h', '4px')
      })
      expect(MockIntersectionObserver.instances).toHaveLength(2)
      first.unmount()

      try {
        // The store died with the last header, so it cannot remember the
        // old value: landing the same value again must bump a fresh store.
        document.documentElement.style.removeProperty('--status-strip-h')
        render(<GalleryDayHeader {...baseProps} surface="page" />)
        expect(MockIntersectionObserver.instances).toHaveLength(3)
        await act(async () => {
          document.documentElement.style.setProperty('--status-strip-h', '4px')
        })
        expect(MockIntersectionObserver.instances).toHaveLength(4)
      } finally {
        await act(async () => {
          document.documentElement.style.removeProperty('--status-strip-h')
        })
      }
    })
  })

  it('marks the heading date with a muted Uploaded suffix', () => {
    render(<GalleryDayHeader {...baseProps} dayKey="uploaded:2025-10-03" />)

    const heading = screen.getByRole('heading')
    expect(heading).toHaveTextContent('Fri 3 Oct 2025 · Uploaded')
    for (const suffix of screen.getAllByText('· Uploaded')) {
      expect(suffix).toHaveClass('text-muted-foreground', 'font-normal')
    }
  })

  it('keeps the place name on the phone meta line', () => {
    render(<GalleryDayHeader {...baseProps} stats={stats()} surface="page" />)

    const meta = screen.getByText('Box Hill, Surrey · 14 · 2 picked')
    expect(meta).toHaveClass('sm:hidden', 'min-w-0', 'truncate')
  })
})
