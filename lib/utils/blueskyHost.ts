import { BLUESKY_DOMAIN } from '@/lib/utils/blueskyId'

// Server-only (kept out of blueskyId.ts, which client components import).
export const isBlueskyHostUrl = (value: string | null | undefined): boolean => {
  if (!value) return false
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname.replace(/\.$/, '') === BLUESKY_DOMAIN
    )
  } catch {
    return false
  }
}
