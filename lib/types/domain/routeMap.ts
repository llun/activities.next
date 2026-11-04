/**
 * The attachment name every generated route map is stored under. A module of
 * its own, with no imports, so client components (the composer and the media
 * details dialog) can read it without pulling the attachment schemas into
 * their bundles; `lib/services/fitness-files/mapAttachments.ts` re-exports it
 * for the server.
 */
export const ROUTE_MAP_ATTACHMENT_NAME = 'Activity route map'
