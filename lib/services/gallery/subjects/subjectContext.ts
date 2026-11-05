import type { MediaSubjectContext } from '@/lib/types/database/gallery'

// Dependency-free: the suggestion prompt (server) and the suggestions caption
// (client) both name the country and month with these.

/** "Japan" for `JP`; the code itself when Intl cannot name it. */
export const countryNameOf = (code: string): string => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

/** "May" for 5; null when the month cannot be named. */
export const monthNameOf = (month: number): string | null => {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  try {
    return new Date(Date.UTC(2000, month - 1, 1)).toLocaleString('en', {
      month: 'long',
      timeZone: 'UTC'
    })
  } catch {
    return null
  }
}

/**
 * The only facts about where and when a photo was taken that the vision model
 * is told: the country code (two letters, upper case) and the month in UTC.
 * Either is null when unknown. Never coordinates or a place name.
 */
export const toSubjectContext = ({
  placeCountryCode,
  takenAt
}: {
  placeCountryCode: string | null
  takenAt: number | null
}): MediaSubjectContext => {
  const code = placeCountryCode?.trim().toUpperCase() ?? ''
  const month =
    typeof takenAt === 'number' && Number.isFinite(takenAt)
      ? new Date(takenAt).getUTCMonth() + 1
      : NaN
  return {
    countryCode: /^[A-Z]{2}$/.test(code) ? code : null,
    month: Number.isInteger(month) ? month : null
  }
}
