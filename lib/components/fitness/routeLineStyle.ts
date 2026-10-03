/**
 * How the activity route is drawn on the interactive map.
 *
 * Every provider draws the same trace — the brand orange over a white casing,
 * with the stretches a privacy location hides in green — so the colours and
 * widths live here and are read by both surfaces: the GL line layers (Mapbox /
 * MapLibre / OpenFreeMap) in `ActivityMapPanel` and the Apple MapKit polylines
 * in `ActivityRouteMapKit`. From the design system's "Route map": a white casing
 * 6 wide at 90% under a #E55F06 (Brand/Primary) line 3.3 wide, which keeps the
 * trace readable on any basemap tile without tinting it.
 */
import { ROUTE_COLOR } from '@/lib/fitness/routeColor'

/** The shared trace. Fully opaque: any transparency would tint #E55F06. */
export const ROUTE_LINE_COLOR = ROUTE_COLOR
export const ROUTE_LINE_WIDTH_PX = 3.3

/** The halo under every drawn stretch, visible and hidden alike. */
export const ROUTE_CASING_COLOR = '#ffffff'
export const ROUTE_CASING_WIDTH_PX = 6
export const ROUTE_CASING_OPACITY = 0.9

/** Stretches hidden from other viewers by a privacy location. */
export const ROUTE_HIDDEN_COLOR = '#16a34a'
export const ROUTE_HIDDEN_WIDTH_PX = 4
export const ROUTE_HIDDEN_OPACITY = 0.95
