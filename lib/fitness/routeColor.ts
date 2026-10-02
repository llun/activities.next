/**
 * The colour an activity route is drawn in, on every surface.
 *
 * Deliberately dependency-free: the interactive map styles
 * (`lib/components/fitness/routeLineStyle.ts`) are client code and the
 * static-image renderers (`generateMapImage.ts`, `appleMapsSnapshot.ts`) are
 * server-only, and a server module may not reach into the client component
 * tree. A constant both sides need lives in a module both can import, so a
 * recolour is one edit.
 *
 * The design system's Brand/Primary. Opaque on purpose: any transparency would
 * tint it.
 */
export const ROUTE_COLOR = '#E55F06'
