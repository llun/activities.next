/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import type { FitnessRouteHeatmapData } from '@/lib/client'
import type { PublicMapProvider } from '@/lib/utils/mapProvider'

import { HeatmapShareEmbed } from './HeatmapShareEmbed'

// The live preview mounts a GL map; stub it so these tests stay focused on the
// panel chrome (tabs, sizes, snippets).
vi.mock('@/lib/components/fitness/RouteHeatmapMap', () => ({
  RouteHeatmapMap: () => <div data-testid="route-map" />
}))

const heatmap: FitnessRouteHeatmapData = {
  id: 'hm-1',
  region: '',
  periodType: 'all_time',
  periodKey: 'all',
  status: 'completed',
  bounds: { minLat: 52, maxLat: 52.6, minLng: 5.6, maxLng: 6.2 },
  segments: [{ points: [{ lat: 52, lng: 5.6 }] }],
  activityCount: 12,
  pointCount: 340,
  totalCount: 20,
  cursorOffset: 20,
  isPartial: false,
  error: null,
  createdAt: 1,
  updatedAt: 2
}

const defaultProps = {
  shareToken: undefined as string | null | undefined,
  embedOrigin: 'https://llun.test',
  regionLabel: undefined as string | undefined,
  isWorld: true,
  heatmap,
  mapProvider: { type: 'osm' } as PublicMapProvider,
  isSharing: false,
  onShare: vi.fn(),
  onUnshare: vi.fn()
}

const textboxValues = (): string[] =>
  screen
    .getAllByRole('textbox')
    .map((node) => (node as HTMLInputElement | HTMLTextAreaElement).value)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('HeatmapShareEmbed', () => {
  it('renders collapsed to a single Share & embed button by default', () => {
    render(<HeatmapShareEmbed {...defaultProps} />)
    const trigger = screen.getByRole('button', { name: /Share & embed/i })
    expect(trigger).toBeInTheDocument()
    // No tabs or snippets until the panel is opened.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('offers Create public link when opened on an unshared heatmap', () => {
    const onShare = vi.fn()
    render(<HeatmapShareEmbed {...defaultProps} onShare={onShare} />)

    fireEvent.click(screen.getByRole('button', { name: /Share & embed/i }))
    // Still no copyable snippets while unshared.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Create public link/i }))
    expect(onShare).toHaveBeenCalledTimes(1)
  })

  it('shows the three share tabs and a stop-sharing action once shared', () => {
    const onUnshare = vi.fn()
    render(
      <HeatmapShareEmbed
        {...defaultProps}
        shareToken="tok123"
        defaultOpen
        onUnshare={onUnshare}
      />
    )

    expect(screen.getByRole('tab', { name: /Embed/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Image/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Link/i })).toBeInTheDocument()

    // The active tab is wired to its panel for screen readers.
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('aria-labelledby', 'share-tab-embed')
    expect(screen.getByRole('tab', { name: /Embed/i })).toHaveAttribute(
      'aria-controls',
      'share-panel-embed'
    )

    // Default (Embed) tab shows the iframe snippet pointing at the embed route.
    expect(
      textboxValues().some((value) =>
        value.includes('https://llun.test/embed/heatmap/tok123"')
      )
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Stop sharing/i }))
    expect(onUnshare).toHaveBeenCalledTimes(1)
  })

  it('switches to the image snippet on the Image tab', () => {
    render(
      <HeatmapShareEmbed {...defaultProps} shareToken="tok123" defaultOpen />
    )

    fireEvent.click(screen.getByRole('tab', { name: /Image/i }))
    // The `&` between query params is entity-escaped inside the HTML attribute.
    expect(
      textboxValues().some((value) =>
        value.includes('/embed/heatmap/tok123/image?w=600&amp;h=420')
      )
    ).toBe(true)
  })

  it('points the Link tab at the public /u/heatmaps page', () => {
    render(
      <HeatmapShareEmbed {...defaultProps} shareToken="tok123" defaultOpen />
    )

    fireEvent.click(screen.getByRole('tab', { name: /Link/i }))
    expect(
      textboxValues().some(
        (value) => value === 'https://llun.test/u/heatmaps/tok123'
      )
    ).toBe(true)
    expect(
      screen.getByRole('link', { name: /Open the public page/i })
    ).toHaveAttribute('href', 'https://llun.test/u/heatmaps/tok123')
  })

  it('updates snippet dimensions when a different size is chosen', () => {
    render(
      <HeatmapShareEmbed {...defaultProps} shareToken="tok123" defaultOpen />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Large' }))
    expect(
      textboxValues().some(
        (value) =>
          value.includes('width="800"') && value.includes('height="560"')
      )
    ).toBe(true)
  })

  it('escapes a quote in the origin so the copyable snippet stays well-formed', () => {
    render(
      <HeatmapShareEmbed
        {...defaultProps}
        embedOrigin={'https://llun.test"x'}
        shareToken="tok123"
        defaultOpen
      />
    )
    expect(
      textboxValues().some((value) =>
        value.includes('src="https://llun.test&quot;x/embed/heatmap/tok123"')
      )
    ).toBe(true)
  })

  it('labels and HTML-escapes the region name in snippets', () => {
    render(
      <HeatmapShareEmbed
        {...defaultProps}
        isWorld={false}
        regionLabel={'Tom & "Jerry" <loop>'}
        shareToken="tok123"
        defaultOpen
      />
    )

    const values = textboxValues()
    expect(
      values.some((value) =>
        value.includes(
          'title="Route heatmap — Tom &amp; &quot;Jerry&quot; &lt;loop&gt;"'
        )
      )
    ).toBe(true)
  })

  describe('copy fields', () => {
    it('are the shared input styling: --input border, shadow-xs, focus ring, no bespoke muted fill', () => {
      render(
        <HeatmapShareEmbed {...defaultProps} shareToken="tok123" defaultOpen />
      )
      fireEvent.click(screen.getByRole('tab', { name: /Link/i }))

      const field = screen.getByRole('textbox', { name: 'Copy public link' })
      // The kit draws the copy field as a normal input (Surface/Input), which is
      // what the `Input` primitive already is.
      expect(field).toHaveAttribute('data-slot', 'input')
      expect(field).toHaveClass('border-input', 'shadow-xs')
      expect(field).toHaveClass('focus-visible:ring-[3px]')
      expect(field).not.toHaveClass('bg-muted/40')
      expect(field).toHaveClass('px-2.5', 'py-1.5', 'text-[12px]')
    })

    it('keeps the Copy button at a normal 36px height, top-aligned with the snippet box', () => {
      render(
        <HeatmapShareEmbed {...defaultProps} shareToken="tok123" defaultOpen />
      )

      const copy = screen.getByRole('button', { name: 'Copy embed code' })
      // Primary/sm, whose icon-led padding (`has-[>svg]:px-2.5`) is what makes it
      // 75 wide with a 14px icon, a 6px gap and the "Copy" label.
      expect(copy).toHaveAttribute('data-size', 'sm')
      expect(copy).toHaveAttribute('data-variant', 'default')
      // jsdom lays nothing out, so pin what decides the height: a fixed `h-9`
      // (36px, not the `sm` size's 32) and no stretching. Stretched, the button
      // was as tall as the snippet box, which wraps to four or five lines at a
      // phone's width: 193px at 390px.
      expect(copy).toHaveClass('h-9')
      expect(copy).not.toHaveClass('h-auto')
      expect(copy).not.toHaveClass('self-stretch')
      // The row starts its children at the top, so a snippet taller than the
      // button leaves the button level with its first line.
      const snippet = screen.getByRole('textbox', { name: 'Copy embed code' })
      expect(copy.parentElement).toBe(snippet.parentElement)
      expect(copy.parentElement).toHaveClass('flex', 'items-start')
      expect(copy.parentElement).not.toHaveClass('items-stretch')
    })

    it('keeps the single-line field at the same 36px as its Copy button', () => {
      render(
        <HeatmapShareEmbed {...defaultProps} shareToken="tok123" defaultOpen />
      )
      fireEvent.click(screen.getByRole('tab', { name: /Link/i }))

      const field = screen.getByRole('textbox', { name: 'Copy public link' })
      const copy = screen.getByRole('button', { name: 'Copy public link' })
      // With the button no longer stretched to the field, a field left at
      // `h-auto` (33.5px of padding and line height) would sit 2.5px short of it.
      expect(field).toHaveClass('h-9')
      expect(field).not.toHaveClass('h-auto')
      expect(copy).toHaveClass('h-9')
      expect(copy.parentElement).toHaveClass('items-start')
    })

    it('grow the snippet box to its whole text instead of scrolling the last line away', () => {
      // jsdom lays nothing out, so give the textarea a measured height: 4 wrapped
      // lines of 17.875px plus 12px padding.
      const scrollHeight = vi
        .spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
        .mockReturnValue(83.5)
      try {
        render(
          <HeatmapShareEmbed
            {...defaultProps}
            shareToken="tok123"
            defaultOpen
          />
        )

        const snippet = screen.getByRole('textbox', {
          name: 'Copy embed code'
        }) as HTMLTextAreaElement
        // Not capped at `rows`: it follows the content.
        expect(snippet.style.height).toBe('83.5px')
        expect(snippet).toHaveClass('field-sizing-fixed', 'resize-none')
      } finally {
        scrollHeight.mockRestore()
      }
    })

    describe('fitting the snippet box', () => {
      // jsdom lays nothing out: drive the measurements the hook reads.
      const layout = {
        scrollHeight: 0,
        offsetWidth: 0,
        offsetHeight: 0,
        clientHeight: 0
      }
      let notifyResize: () => void
      let observers: number
      let disconnected: number
      const observeSpy = vi.fn()

      beforeEach(() => {
        Object.assign(layout, {
          scrollHeight: 0,
          offsetWidth: 0,
          offsetHeight: 0,
          clientHeight: 0
        })
        observers = 0
        disconnected = 0
        notifyResize = () => {}
        vi.spyOn(
          HTMLTextAreaElement.prototype,
          'scrollHeight',
          'get'
        ).mockImplementation(() => layout.scrollHeight)
        vi.spyOn(
          HTMLElement.prototype,
          'offsetWidth',
          'get'
        ).mockImplementation(() => layout.offsetWidth)
        vi.spyOn(
          HTMLElement.prototype,
          'offsetHeight',
          'get'
        ).mockImplementation(() => layout.offsetHeight)
        vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(
          () => layout.clientHeight
        )
        class FakeResizeObserver {
          constructor(callback: ResizeObserverCallback) {
            observers += 1
            notifyResize = () => callback([], this as never)
          }
          observe = observeSpy
          unobserve = vi.fn()
          disconnect = () => {
            disconnected += 1
          }
        }
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
      })

      afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
      })

      const snippet = () =>
        screen.getByRole('textbox', {
          name: 'Copy embed code'
        }) as HTMLTextAreaElement

      it('keeps the rows height while nothing is laid out, instead of collapsing to 0px', () => {
        render(
          <HeatmapShareEmbed
            {...defaultProps}
            shareToken="tok123"
            defaultOpen
          />
        )

        expect(snippet().style.height).toBe('auto')
      })

      it('adds the borders to the measured content height', () => {
        layout.scrollHeight = 80
        layout.offsetHeight = 84
        layout.clientHeight = 82

        render(
          <HeatmapShareEmbed
            {...defaultProps}
            shareToken="tok123"
            defaultOpen
          />
        )

        expect(snippet().style.height).toBe('82px')
      })

      it('re-fits only when the width changes, and stops observing on unmount', () => {
        layout.scrollHeight = 80
        layout.offsetWidth = 500
        const { unmount } = render(
          <HeatmapShareEmbed
            {...defaultProps}
            shareToken="tok123"
            defaultOpen
          />
        )
        expect(observers).toBe(1)
        expect(observeSpy).toHaveBeenCalledWith(snippet())
        expect(snippet().style.height).toBe('80px')

        // Our own height write fires the observer with the width unchanged.
        layout.scrollHeight = 120
        notifyResize()
        expect(snippet().style.height).toBe('80px')

        // A narrower box wraps to more lines.
        layout.offsetWidth = 300
        notifyResize()
        expect(snippet().style.height).toBe('120px')

        unmount()
        expect(disconnected).toBeGreaterThan(0)
      })

      it('re-fits when the snippet text changes', () => {
        layout.scrollHeight = 80
        const { rerender } = render(
          <HeatmapShareEmbed
            {...defaultProps}
            shareToken="tok123"
            defaultOpen
          />
        )
        expect(snippet().style.height).toBe('80px')

        layout.scrollHeight = 100
        rerender(
          <HeatmapShareEmbed
            {...defaultProps}
            shareToken="tok-with-a-much-longer-value"
            defaultOpen
          />
        )

        expect(snippet().style.height).toBe('100px')
      })
    })

    it('keep the iframe title attribute while showing the whole snippet', () => {
      render(
        <HeatmapShareEmbed {...defaultProps} shareToken="tok123" defaultOpen />
      )

      // An iframe needs a title for assistive tech; the fix for the clipped last
      // line is a taller box, not dropping the line.
      expect(
        textboxValues().some((value) =>
          value.includes('title="Route heatmap — Whole world"></iframe>')
        )
      ).toBe(true)
    })
  })
})
