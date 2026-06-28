// A "real" avatar is an actual upload, not one synthesized by a placeholder or
// identicon service. Actor/account UI falls back to initials for the latter
// rather than rendering an auto-generated image.
const GENERATED_AVATAR_MARKERS = [
  'gravatar',
  'ui-avatars',
  'robohash',
  'dicebear',
  'boringavatars',
  'default',
  'placeholder'
]

export const isRealAvatar = (url?: string | null): boolean => {
  if (!url) return false
  return !GENERATED_AVATAR_MARKERS.some((marker) => url.includes(marker))
}
