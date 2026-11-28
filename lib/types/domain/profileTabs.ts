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

export type ProfileTab = 'posts' | 'replies' | 'media' | 'gallery' | 'fitness'

export const PROFILE_TAB_LABELS: Record<ProfileTab, string> = {
  posts: 'Posts',
  replies: 'Replies',
  media: 'Media',
  gallery: 'Gallery',
  fitness: 'Fitness'
}

// Whether there is anything behind each optional tab for the viewer it is
// resolved for. Posts is always offered, so it has no entry.
export type ProfileTabContent = {
  hasMedia: boolean
  hasGallery: boolean
  hasFitness: boolean
}

// The tabs a profile offers, in display order. Posts is always first; every
// other tab needs both its content and the owner's switch.
export const getAvailableProfileTabs = ({
  tabVisibility,
  isInternalAccount,
  content
}: {
  tabVisibility: ProfileTabVisibility
  isInternalAccount: boolean
  content: ProfileTabContent
}): ProfileTab[] => {
  const tabs: ProfileTab[] = ['posts']
  if (isInternalAccount && tabVisibility.replies) {
    tabs.push('replies')
  }
  if (content.hasMedia && tabVisibility.media) {
    tabs.push('media')
  }
  if (content.hasGallery && tabVisibility.gallery) {
    tabs.push('gallery')
  }
  if (content.hasFitness && tabVisibility.fitness) {
    tabs.push('fitness')
  }
  return tabs
}
