const isLocalHost = (host: string) =>
  host.startsWith('localhost') ||
  host.startsWith('127.0.0.1') ||
  host.startsWith('::1') ||
  host.startsWith('[::1]')

/**
 * Public URL for a stored media path.
 *
 * Both the local-file and object storages serve their files through
 * `/api/v1/files/:path`, so a path resolves to a URL without going back through
 * the storage driver. Shared by `getMediaAttachment` (the Mastodon entity) and
 * by callers holding a bare stored path, such as the route map's JPEG twin.
 */
export const getMediaFileUrl = (host: string, mediaPath: string): string => {
  const protocol = isLocalHost(host) ? 'http' : 'https'
  return `${protocol}://${host}/api/v1/files/${mediaPath}`
}
