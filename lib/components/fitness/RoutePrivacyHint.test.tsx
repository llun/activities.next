/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import {
  ROUTE_PRIVACY_HINT_LABEL,
  RoutePrivacyDescription,
  RoutePrivacyHint,
  getRoutePrivacyHintPlacement,
  isHoverCapablePointer
} from './RoutePrivacyHint'

// A 300x200 map with a 160x26 chip — the real proportions of an `h-72` panel
// and the rendered label.
const CONTAINER = { width: 300, height: 200 }
const CHIP = { width: 160, height: 26 }

describe('getRoutePrivacyHintPlacement', () => {
  it('centres the chip above the pointer when there is room', () => {
    expect(
      getRoutePrivacyHintPlacement({ x: 150, y: 120 }, CHIP, CONTAINER)
    ).toEqual({ left: 70, top: 82 })
  })

  it.each([
    {
      description: 'a pointer against the left edge',
      point: { x: 4, y: 120 },
      expectedLeft: 6
    },
    {
      description: 'a pointer against the right edge',
      point: { x: 296, y: 120 },
      expectedLeft: 134
    }
  ])(
    'keeps the chip inside the map for $description',
    ({ point, expectedLeft }) => {
      const { left } = getRoutePrivacyHintPlacement(point, CHIP, CONTAINER)

      expect(left).toBe(expectedLeft)
      expect(left).toBeGreaterThanOrEqual(0)
      expect(left + CHIP.width).toBeLessThanOrEqual(CONTAINER.width)
    }
  )

  it('flips below the pointer when the chip would overrun the top edge', () => {
    // The map panel is overflow-hidden, so a chip placed above a pointer near
    // the top is not just clipped — it is invisible. Hidden stretches are the
    // trimmed ends of the route, which fitBounds parks right at the rim, so
    // this is the common hover, not an edge case.
    const { top } = getRoutePrivacyHintPlacement(
      { x: 150, y: 20 },
      CHIP,
      CONTAINER
    )

    expect(top).toBe(32)
    expect(top).toBeGreaterThan(20)
  })

  it('keeps a flipped chip inside the bottom edge', () => {
    const { top } = getRoutePrivacyHintPlacement({ x: 150, y: 8 }, CHIP, {
      width: 300,
      height: 40
    })

    expect(top + CHIP.height).toBeLessThanOrEqual(40)
  })

  it('pins a chip wider than the map to its left edge rather than centring it', () => {
    const { left } = getRoutePrivacyHintPlacement(
      { x: 60, y: 120 },
      { width: 400, height: 26 },
      CONTAINER
    )

    // Centring would lose both ends of the sentence; pinning left keeps it
    // readable from its start.
    expect(left).toBe(6)
  })
})

describe('isHoverCapablePointer', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it.each([
    { description: 'a device that can hover', matches: true, expected: true },
    { description: 'a touch-only device', matches: false, expected: false }
  ])('reports $description', ({ matches, expected }) => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches, media: query })
    })

    expect(isHoverCapablePointer()).toBe(expected)
  })

  it('reports no hover when matchMedia is unavailable', () => {
    expect(isHoverCapablePointer()).toBe(false)
  })
})

describe('RoutePrivacyHint', () => {
  it('renders nothing without an anchor point', () => {
    render(<RoutePrivacyHint point={null} />)

    expect(screen.queryByTestId('route-privacy-hint')).not.toBeInTheDocument()
  })

  it('never intercepts a map gesture and never double-announces', () => {
    render(<RoutePrivacyHint point={{ x: 40, y: 90 }} />)

    const hint = screen.getByTestId('route-privacy-hint')
    expect(hint).toHaveTextContent(ROUTE_PRIVACY_HINT_LABEL)
    // An overlay that could swallow a drag would make part of the map
    // unpannable — the whole reason the pinned bar was replaced.
    expect(hint).toHaveClass('pointer-events-none')
    // The sentence reaches assistive technology through
    // RoutePrivacyDescription instead, so the chip must stay out of the
    // accessibility tree rather than announcing it a second time.
    expect(hint).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('RoutePrivacyDescription', () => {
  it('states the explanation without needing a hover', () => {
    render(<RoutePrivacyDescription hasHiddenSegments />)

    expect(screen.getByText(/hidden sections are drawn in green/i)).toHaveClass(
      'sr-only'
    )
  })

  it('says nothing when the route hides nothing', () => {
    render(<RoutePrivacyDescription hasHiddenSegments={false} />)

    expect(
      screen.queryByText(/hidden sections are drawn in green/i)
    ).not.toBeInTheDocument()
  })
})
