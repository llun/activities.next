/**
 * The marker the fitness activity map drops on the route while the analysis
 * charts are hovered.
 *
 * Every provider draws the same thing — a white halo with a coloured core,
 * centred exactly on the hovered route sample — so the geometry and colours live
 * here and are read by both surfaces: the GL circle layers (Mapbox /
 * OpenFreeMap) and the Apple MapKit annotation. Apple used to render a
 * `MarkerAnnotation` instead, whose teardrop pin is anchored by its tip and so
 * covers the map *above* the point it marks; the highlight therefore sat visibly
 * off-route on Apple maps only.
 */

/** GL paints circles by radius; the DOM dot derives its diameters from these. */
export const ROUTE_HIGHLIGHT_HALO_RADIUS_PX = 8
export const ROUTE_HIGHLIGHT_CORE_RADIUS_PX = 4.5
export const ROUTE_HIGHLIGHT_HALO_COLOR = '#ffffff'
export const ROUTE_HIGHLIGHT_HALO_OPACITY = 0.95
/** Blue on the shared trace, green on segments hidden by a privacy location. */
export const ROUTE_HIGHLIGHT_CORE_COLOR = '#1d4ed8'
export const ROUTE_HIGHLIGHT_HIDDEN_CORE_COLOR = '#16a34a'

export const getRouteHighlightCoreColor = (isHiddenByPrivacy: boolean) =>
  isHiddenByPrivacy
    ? ROUTE_HIGHLIGHT_HIDDEN_CORE_COLOR
    : ROUTE_HIGHLIGHT_CORE_COLOR

const createDot = (diameterPx: number, color: string) => {
  const dot = document.createElement('div')
  dot.style.position = 'absolute'
  dot.style.left = '0px'
  dot.style.top = '0px'
  dot.style.width = `${diameterPx}px`
  dot.style.height = `${diameterPx}px`
  dot.style.borderRadius = '50%'
  dot.style.backgroundColor = color
  // Pull the dot back by half its own size so its centre — not its top-left
  // corner — lands on the anchor's origin.
  dot.style.transform = 'translate(-50%, -50%)'
  return dot
}

/**
 * Build the element Apple MapKit renders for a custom (`mapkit.Annotation`)
 * highlight marker.
 *
 * MapKit anchors an annotation element by its BOTTOM CENTRE, which is what makes
 * a naively-sized element float above the coordinate — the same offset the pin
 * had. The returned node is therefore a zero-sized anchor with the halo and core
 * translated onto its origin: on a zero-sized box the bottom centre, the centre
 * and the origin are all the same point, so the dot lands on the sample without
 * an `anchorOffset` correction (and so without `DOMPoint`, which jsdom does not
 * implement) — and it stays centred whichever corner MapKit anchors by.
 *
 * The halo and core are siblings rather than nested so the halo's opacity does
 * not wash out the core, matching the two independent GL circle layers.
 */
export const createRouteHighlightElement = (
  isHiddenByPrivacy: boolean
): HTMLElement => {
  const anchor = document.createElement('div')
  anchor.style.position = 'relative'
  anchor.style.width = '0px'
  anchor.style.height = '0px'
  // Both dots live outside a zero-sized box, so nothing may clip them.
  anchor.style.overflow = 'visible'
  // A hover follower is decoration: it must never swallow map gestures.
  anchor.style.pointerEvents = 'none'

  const halo = createDot(
    ROUTE_HIGHLIGHT_HALO_RADIUS_PX * 2,
    ROUTE_HIGHLIGHT_HALO_COLOR
  )
  halo.style.opacity = String(ROUTE_HIGHLIGHT_HALO_OPACITY)

  const core = createDot(
    ROUTE_HIGHLIGHT_CORE_RADIUS_PX * 2,
    getRouteHighlightCoreColor(isHiddenByPrivacy)
  )

  anchor.append(halo, core)
  return anchor
}
