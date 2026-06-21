/**
 * Compact "time ago" label for fitness heatmap chrome. Takes a precomputed
 * millisecond delta (currentTime − timestamp) so callers stay hydration-safe by
 * passing a server-provided `currentTime` rather than reading the clock during
 * render.
 */
export const formatRelativeTime = (diffMs: number): string => {
  if (diffMs < 60_000) return 'just now'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`
  return `${Math.floor(diffMs / 86_400_000)}d ago`
}
