// Bluesky accounts and posts are stored under https://bsky.app/profile/... ids.
// They are not ActivityPub objects: never fetch, sign for or deliver to them.
export const isBlueskyId = (id: string | null | undefined): boolean => {
  if (!id) return false
  try {
    const url = new URL(id)
    return (
      url.protocol === 'https:' &&
      url.host === 'bsky.app' &&
      url.pathname.startsWith('/profile/')
    )
  } catch {
    return false
  }
}
