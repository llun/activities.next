export const ALL_MEDIA_PATH = '/gallery/media'

/**
 * The All media address for a set of search params, in the shape Next hands a
 * page its `searchParams` (a repeated key is an array). Every key is kept, in
 * order, so `/gallery/recent?category=bird&show=hidden` lands on
 * `/gallery/media?category=bird&show=hidden`.
 */
export const getAllMediaPath = (
  searchParams: Record<string, string | string[] | undefined> = {}
): string => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue
    for (const entry of Array.isArray(value) ? value : [value]) {
      query.append(key, entry)
    }
  }
  const search = query.toString()
  return search ? `${ALL_MEDIA_PATH}?${search}` : ALL_MEDIA_PATH
}
