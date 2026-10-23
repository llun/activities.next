// Which optional profile tabs the owner shows. Presentation only: a hidden tab
// is not offered to anyone, but what is in it stays as readable through the
// API and other pages as before. Posts is always shown, so it has no flag.
export type ProfileTabVisibility = {
  replies: boolean
  media: boolean
  gallery: boolean
  fitness: boolean
}

export const SHOW_ALL_PROFILE_TABS: ProfileTabVisibility = {
  replies: true,
  media: true,
  gallery: true,
  fitness: true
}
