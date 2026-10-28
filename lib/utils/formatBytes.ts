const UNITS = ['KB', 'MB', 'GB', 'TB'] as const

/** Format a byte count for display, using powers of 1024. */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.floor(bytes)} B`

  let value = bytes
  let unitIndex = -1
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(1)} ${UNITS[unitIndex]}`
}
