/**
 * @vitest-environment jsdom
 */
import {
  ROUTE_HIGHLIGHT_CORE_COLOR,
  ROUTE_HIGHLIGHT_CORE_RADIUS_PX,
  ROUTE_HIGHLIGHT_HALO_COLOR,
  ROUTE_HIGHLIGHT_HALO_OPACITY,
  ROUTE_HIGHLIGHT_HALO_RADIUS_PX,
  ROUTE_HIGHLIGHT_HIDDEN_CORE_COLOR,
  createRouteHighlightElement,
  getRouteHighlightCoreColor
} from './routeHighlightMarker'

const dotsOf = (element: HTMLElement) =>
  Array.from(element.children) as HTMLElement[]

describe('getRouteHighlightCoreColor', () => {
  it.each([
    {
      description: 'blue on a shared segment',
      isHiddenByPrivacy: false,
      expected: ROUTE_HIGHLIGHT_CORE_COLOR
    },
    {
      description: 'green on a privacy-hidden segment',
      isHiddenByPrivacy: true,
      expected: ROUTE_HIGHLIGHT_HIDDEN_CORE_COLOR
    }
  ])('returns $description', ({ isHiddenByPrivacy, expected }) => {
    expect(getRouteHighlightCoreColor(isHiddenByPrivacy)).toBe(expected)
  })
})

describe('createRouteHighlightElement', () => {
  it('anchors a zero-sized node so MapKit centres the dot on the coordinate', () => {
    // MapKit positions a custom annotation by its element's bottom centre; on a
    // zero-sized element that is the element's own origin, which is what keeps
    // the marker on the route sample instead of floating above it like the pin.
    const element = createRouteHighlightElement(false)

    expect(element.style.width).toBe('0px')
    expect(element.style.height).toBe('0px')
    expect(element.style.position).toBe('relative')
    expect(element.style.pointerEvents).toBe('none')

    for (const dot of dotsOf(element)) {
      expect(dot.style.position).toBe('absolute')
      expect(dot.style.left).toBe('0px')
      expect(dot.style.top).toBe('0px')
      expect(dot.style.transform).toBe('translate(-50%, -50%)')
      expect(dot.style.borderRadius).toBe('50%')
    }
  })

  it('draws the halo and the core as siblings matching the GL circle layers', () => {
    const [halo, core] = dotsOf(createRouteHighlightElement(false))

    expect(halo.style.width).toBe(`${ROUTE_HIGHLIGHT_HALO_RADIUS_PX * 2}px`)
    expect(halo.style.height).toBe(`${ROUTE_HIGHLIGHT_HALO_RADIUS_PX * 2}px`)
    expect(halo.style.backgroundColor).toBe('rgb(255, 255, 255)')
    expect(ROUTE_HIGHLIGHT_HALO_COLOR).toBe('#ffffff')
    expect(halo.style.opacity).toBe(String(ROUTE_HIGHLIGHT_HALO_OPACITY))

    expect(core.style.width).toBe(`${ROUTE_HIGHLIGHT_CORE_RADIUS_PX * 2}px`)
    expect(core.style.height).toBe(`${ROUTE_HIGHLIGHT_CORE_RADIUS_PX * 2}px`)
    // A sibling, not a child of the halo — nesting would multiply the halo's
    // opacity into the core and wash it out.
    expect(core.parentElement).not.toBe(halo)
    expect(core.style.opacity).toBe('')
  })

  it('colours the core green for a privacy-hidden sample', () => {
    const [, core] = dotsOf(createRouteHighlightElement(true))

    expect(core.style.backgroundColor).toBe('rgb(22, 163, 74)')
    expect(ROUTE_HIGHLIGHT_HIDDEN_CORE_COLOR).toBe('#16a34a')
  })
})
