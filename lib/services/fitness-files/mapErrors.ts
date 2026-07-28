/**
 * Reasons written to `fitness_files.mapError` that the UI keys its copy off.
 *
 * Dependency-free on purpose: both jobs write it and a Client Component reads
 * it, and everything else in `fitness-files/` pulls in the database and the
 * media storages (see Server/Client Module Boundary in AGENTS.md).
 */

/**
 * The map itself is fine, but an older one could not be removed.
 *
 * Distinct from a generation reason because the post is in the opposite state:
 * it has a map, and one too many. The next processing run's orphan sweep is
 * what repairs it, so the owner's retry is the fix.
 */
export const MAP_CLEANUP_ERROR = 'Failed to remove the previous route map'
