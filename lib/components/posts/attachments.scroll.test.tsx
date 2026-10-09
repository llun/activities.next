/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { Attachments } from './attachments'
import {
  buildAttachment,
  buildNoteStatus,
  createdObservers,
  disconnectedObservers,
  observedElements,
  resetAttachmentTestState,
  resizeCallbacks
} from './attachments.testUtils'

beforeEach(() => {
  resetAttachmentTestState()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Attachments', () => {
  describe('scroll affordances', () => {
    // jsdom lays nothing out, so the strip's geometry has to be stamped on and
    // a scroll event fired to put the component into a scrolled state.
    const renderScrolledStrip = ({ scrollLeft }: { scrollLeft: number }) => {
      render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600 }),
            buildAttachment({ width: 800, height: 600 }),
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )
      const strip = screen.getByRole('group')
      Object.defineProperty(strip, 'scrollWidth', {
        configurable: true,
        value: 1000
      })
      Object.defineProperty(strip, 'clientWidth', {
        configurable: true,
        value: 500
      })
      Object.defineProperty(strip, 'scrollLeft', {
        configurable: true,
        value: scrollLeft
      })
      fireEvent.scroll(strip)
      return strip
    }

    it('promises more media only once there is more to reach', () => {
      render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600 }),
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      // jsdom lays nothing out, so nothing overflows and the label must not
      // tell a screen-reader user to scroll to content that is not there.
      expect(
        screen.getByRole('group', { name: '2 media attachments' })
      ).toBeInTheDocument()
    })

    it('promises more media once the strip overflows', () => {
      renderScrolledStrip({ scrollLeft: 0 })

      expect(
        screen.getByRole('group', {
          name: '3 media attachments, scroll for more'
        })
      ).toBeInTheDocument()
    })

    it.each([
      { scrollLeft: 0, disabled: 'Previous media' },
      { scrollLeft: 250, disabled: undefined },
      { scrollLeft: 500, disabled: 'Next media' }
    ])(
      'keeps both arrows mounted and disables only the one at an edge at scrollLeft $scrollLeft',
      ({ scrollLeft, disabled }) => {
        renderScrolledStrip({ scrollLeft })

        for (const name of ['Previous media', 'Next media']) {
          const arrow = screen.getByRole('button', { name })
          if (name === disabled) {
            expect(arrow).toHaveAttribute('aria-disabled', 'true')
            expect(arrow).toHaveAttribute('tabindex', '-1')
          } else {
            expect(arrow).toHaveAttribute('aria-disabled', 'false')
            expect(arrow).not.toHaveAttribute('tabindex')
          }
        }
      }
    )

    it('does not scroll when an edge arrow is clicked', () => {
      const strip = renderScrolledStrip({ scrollLeft: 0 })
      const scrollBy = vi.fn()
      Object.defineProperty(strip, 'scrollBy', {
        configurable: true,
        value: scrollBy
      })

      fireEvent.click(screen.getByRole('button', { name: 'Previous media' }))

      expect(scrollBy).not.toHaveBeenCalled()
    })

    it('keeps keyboard focus on the forward arrow when it moves to the end', () => {
      // Focus on a button that unmounts drops to <body>, which would send the
      // next Tab back to the top of the page. The arrow stays in place and
      // focus moves to the back arrow, which now has somewhere to go.
      const strip = renderScrolledStrip({ scrollLeft: 250 })
      const next = screen.getByRole('button', { name: 'Next media' })
      next.focus()
      expect(document.activeElement).toBe(next)

      Object.defineProperty(strip, 'scrollLeft', {
        configurable: true,
        value: 500
      })
      fireEvent.scroll(strip)

      expect(next).toHaveAttribute('aria-disabled', 'true')
      expect(document.activeElement).not.toBe(document.body)
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Previous media' })
      )
    })

    it('keeps keyboard focus on the back arrow when it moves to the start', () => {
      const strip = renderScrolledStrip({ scrollLeft: 250 })
      const previous = screen.getByRole('button', { name: 'Previous media' })
      previous.focus()

      Object.defineProperty(strip, 'scrollLeft', {
        configurable: true,
        value: 0
      })
      fireEvent.scroll(strip)

      expect(previous).toHaveAttribute('aria-disabled', 'true')
      expect(document.activeElement).not.toBe(document.body)
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Next media' })
      )
    })

    it('shows a position counter that follows the scroll position', () => {
      render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600 }),
            buildAttachment({ width: 800, height: 600 }),
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )
      const strip = screen.getByRole('group')
      Object.defineProperty(strip, 'scrollWidth', {
        configurable: true,
        value: 1000
      })
      Object.defineProperty(strip, 'clientWidth', {
        configurable: true,
        value: 500
      })
      // Three 500px cards laid end to end, so the midpoints sit at 250, 750, 1250.
      Array.from(strip.children).forEach((child, index) => {
        Object.defineProperty(child, 'offsetLeft', {
          configurable: true,
          value: index * 500
        })
        Object.defineProperty(child, 'offsetWidth', {
          configurable: true,
          value: 500
        })
      })
      Object.defineProperty(strip, 'scrollLeft', {
        configurable: true,
        value: 0
      })
      fireEvent.scroll(strip)

      const counter = screen.getByText('1 / 3')
      expect(counter).toHaveAttribute('aria-hidden', 'true')

      Object.defineProperty(strip, 'scrollLeft', {
        configurable: true,
        value: 250
      })
      fireEvent.scroll(strip)
      expect(screen.getByText('2 / 3')).toBeInTheDocument()
    })

    // Lays out `count` cards of `cardWidth` end to end inside a strip whose
    // viewport is 500px and whose content is `count * cardWidth` wide.
    const renderLaidOutStrip = ({
      count,
      cardWidth,
      scrollLeft
    }: {
      count: number
      cardWidth: number
      scrollLeft: number
    }) => {
      render(
        <Attachments
          status={buildNoteStatus(
            Array.from({ length: count }, () =>
              buildAttachment({ width: 800, height: 600 })
            )
          )}
          onMediaSelected={vi.fn()}
        />
      )
      const strip = screen.getByRole('group')
      Object.defineProperty(strip, 'scrollWidth', {
        configurable: true,
        value: count * cardWidth
      })
      Object.defineProperty(strip, 'clientWidth', {
        configurable: true,
        value: 500
      })
      Array.from(strip.children).forEach((child, index) => {
        Object.defineProperty(child, 'offsetLeft', {
          configurable: true,
          value: index * cardWidth
        })
        Object.defineProperty(child, 'offsetWidth', {
          configurable: true,
          value: cardWidth
        })
      })
      Object.defineProperty(strip, 'scrollLeft', {
        configurable: true,
        value: scrollLeft
      })
      fireEvent.scroll(strip)
      return strip
    }

    it('reads the last position once the strip is scrolled to its end', () => {
      renderLaidOutStrip({ count: 3, cardWidth: 500, scrollLeft: 1000 })

      expect(screen.getByText('3 / 3')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Next media' })
      ).toHaveAttribute('aria-disabled', 'true')
    })

    it('reads the last position at the end even when the last card is narrow', () => {
      // Five 200px cards: the Next arrow is disabled at scrollLeft 500, yet the
      // first card whose midpoint is past the edge would be card 3.
      renderLaidOutStrip({ count: 5, cardWidth: 200, scrollLeft: 500 })

      expect(screen.getByText('5 / 5')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Next media' })
      ).toHaveAttribute('aria-disabled', 'true')
    })

    it('counts a card as reached once its left edge is within sub-pixel slack of the viewport', () => {
      renderLaidOutStrip({ count: 3, cardWidth: 500, scrollLeft: 502 })

      expect(screen.getByText('2 / 3')).toBeInTheDocument()
    })

    it('does not count a card still partly scrolled off to the left', () => {
      renderLaidOutStrip({ count: 3, cardWidth: 500, scrollLeft: 100 })

      expect(screen.getByText('2 / 3')).toBeInTheDocument()
    })

    it('re-reads the position when the viewport resizes without a scroll event', () => {
      const strip = renderLaidOutStrip({
        count: 3,
        cardWidth: 500,
        scrollLeft: 0
      })
      expect(screen.getByText('1 / 3')).toBeInTheDocument()

      Object.defineProperty(strip, 'scrollLeft', {
        configurable: true,
        value: 1000
      })
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      expect(screen.getByText('3 / 3')).toBeInTheDocument()
    })

    it('hides the counter and arrows when the strip does not overflow', () => {
      render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600 }),
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(screen.queryByText(/^\d+ \/ \d+$/)).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Next media' })
      ).not.toBeInTheDocument()
    })

    it('re-measures when an edit changes item widths but not their count', () => {
      // The hook is keyed on the laid-out WIDTHS for exactly this case: the
      // observer watches the container, which does not resize, the count is
      // unchanged, and scrollLeft stays 0 — so a count-keyed effect would never
      // re-run and the forward chevron would sit over a strip that now fits.
      const panorama = buildAttachment({ width: 1200, height: 500 })
      const portrait = buildAttachment({ width: 600, height: 900 })
      const replacement = buildAttachment({ width: 600, height: 900 })
      const { rerender } = render(
        <Attachments
          status={buildNoteStatus([panorama, portrait])}
          onMediaSelected={vi.fn()}
        />
      )

      // Geometry behind a getter so the rerender can change it without
      // re-stamping the node React is about to reuse.
      const strip = screen.getByRole('group')
      const geometry = { scrollWidth: 1000 }
      Object.defineProperty(strip, 'scrollWidth', {
        configurable: true,
        get: () => geometry.scrollWidth
      })
      Object.defineProperty(strip, 'clientWidth', {
        configurable: true,
        value: 500
      })
      Object.defineProperty(strip, 'scrollLeft', {
        configurable: true,
        value: 0
      })
      fireEvent.scroll(strip)
      expect(
        screen.getByRole('button', { name: 'Next media' })
      ).toBeInTheDocument()

      // 576 + 160 becomes 160 + 160: same two items, and now it all fits.
      geometry.scrollWidth = 400
      rerender(
        <Attachments
          status={buildNoteStatus([replacement, portrait])}
          onMediaSelected={vi.fn()}
        />
      )

      // Nothing overflows any more, so the chrome itself is gone.
      expect(
        screen.queryByRole('button', { name: 'Next media' })
      ).not.toBeInTheDocument()
    })

    it.each([
      { description: 'the forward arrow', name: 'Next media' },
      { description: 'the back chevron', name: 'Previous media' }
    ])(
      '$description stops its click from reaching an ancestor click handler',
      ({ name }) => {
        // The chevrons sit inside the clickable post row, so a click that
        // escaped would scroll the strip AND navigate away from the timeline.
        const parentOnClick = vi.fn()
        render(
          <div onClick={parentOnClick}>
            <Attachments
              status={buildNoteStatus([
                buildAttachment({ width: 800, height: 600 }),
                buildAttachment({ width: 800, height: 600 }),
                buildAttachment({ width: 800, height: 600 })
              ])}
              onMediaSelected={vi.fn()}
            />
          </div>
        )
        const strip = screen.getByRole('group')
        Object.defineProperty(strip, 'scrollWidth', {
          configurable: true,
          value: 1000
        })
        Object.defineProperty(strip, 'clientWidth', {
          configurable: true,
          value: 500
        })
        Object.defineProperty(strip, 'scrollLeft', {
          configurable: true,
          value: 250
        })
        Object.defineProperty(strip, 'scrollBy', {
          configurable: true,
          value: vi.fn()
        })
        fireEvent.scroll(strip)

        fireEvent.click(screen.getByRole('button', { name }))

        expect(parentOnClick).not.toHaveBeenCalled()
      }
    )

    it.each([
      { name: 'Next media', expectedLeft: 250 },
      { name: 'Previous media', expectedLeft: -250 }
    ])('$name moves in its enabled direction', ({ name, expectedLeft }) => {
      const strip = renderScrolledStrip({ scrollLeft: 250 })
      const scrollBy = vi.fn()
      Object.defineProperty(strip, 'scrollBy', {
        configurable: true,
        value: scrollBy
      })

      fireEvent.click(screen.getByRole('button', { name }))

      expect(scrollBy).toHaveBeenCalledWith({
        left: expectedLeft,
        behavior: 'smooth'
      })
    })
  })

  it('disconnects every caption and strip resize observer on unmount', () => {
    const { unmount } = render(
      <Attachments
        status={buildNoteStatus([
          buildAttachment({ width: 800, height: 600, name: 'First caption' }),
          buildAttachment({ width: 800, height: 600, name: 'Second caption' })
        ])}
        onMediaSelected={vi.fn()}
      />
    )

    expect(observedElements).toHaveLength(3)
    unmount()
    expect(disconnectedObservers).toBe(createdObservers)
    expect(resizeCallbacks).toHaveLength(0)
  })
})
