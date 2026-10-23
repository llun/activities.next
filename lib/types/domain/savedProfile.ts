// The profile an editor needs after a save, returned by
// `PATCH /api/v1/accounts/profile`. Values are the raw stored text (not
// rendered HTML); `verifiedAt` is an ISO 8601 time, or null for a link that
// has not been seen linking back.
export type SavedProfileField = {
  name: string
  value: string
  verifiedAt: string | null
}

export type SavedProfile = {
  name: string
  summary: string
  fields: SavedProfileField[]
  iconUrl: string | null
  headerImageUrl: string | null
  avatarDescription: string
  headerDescription: string
  // Profile tabs: every one defaults to shown. Posts is always shown.
  showReplies: boolean
  showMedia: boolean
  showGallery: boolean
  showFitness: boolean
}

// The JSON body of `PATCH /api/v1/accounts/profile`; every key is optional and
// an absent key leaves the stored value alone. A null image URL clears it.
export type UpdateProfileInput = {
  /**
   * The actor the page was loaded for; the server refuses with 409 when the
   * session has moved to another one.
   */
  actorId?: string
  name?: string
  summary?: string
  fields?: { name: string; value: string }[]
  iconUrl?: string | null
  headerImageUrl?: string | null
  avatarDescription?: string
  headerDescription?: string
  showReplies?: boolean
  showMedia?: boolean
  showGallery?: boolean
  showFitness?: boolean
}
