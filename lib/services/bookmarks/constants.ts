// Dependency-free, so the Bookmarks page (server) and its client timeline read
// the same values.

/** `folder_id` (API) and `?folder=` (page) for the unfiled bookmarks. */
export const UNFILED_BOOKMARK_FOLDER = 'none'

/** The page's view of every bookmark, filed or not; never sent to the API. */
export const ALL_BOOKMARKS = 'all'
