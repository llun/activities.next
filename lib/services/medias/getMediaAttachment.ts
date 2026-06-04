import {
  MediaStorageSaveFileOutput,
  MediaType
} from '@/lib/services/medias/types'
import { Media } from '@/lib/types/database/operations'

const isLocalHost = (host: string) =>
  host.startsWith('localhost') ||
  host.startsWith('127.0.0.1') ||
  host.startsWith('::1') ||
  host.startsWith('[::1]')

const mediaMeta = (metaData: Media['original']['metaData']) => {
  const width = metaData.width ?? 0
  const height = metaData.height ?? 0
  return {
    width,
    height,
    size: `${width}x${height}`,
    aspect: width / (height || 1)
  }
}

// Builds the Mastodon MediaAttachment entity for an already-stored media row.
// Both the local-file and S3 storages serve files through `/api/v1/files/:path`,
// so the public URL can be reconstructed without going back through the storage
// driver. Used by GET/PUT /api/v1/media/:id, which operate on persisted media.
export const getMediaAttachment = (
  media: Media,
  host: string
): MediaStorageSaveFileOutput => {
  const protocol = isLocalHost(host) ? 'http' : 'https'
  const url = `${protocol}://${host}/api/v1/files/${media.original.path}`
  const previewUrl = media.thumbnail
    ? `${protocol}://${host}/api/v1/files/${media.thumbnail.path}`
    : url
  const type = media.original.mimeType.startsWith('video')
    ? MediaType.enum.video
    : MediaType.enum.image

  return MediaStorageSaveFileOutput.parse({
    id: `${media.id}`,
    type,
    mime_type: media.original.mimeType,
    url,
    preview_url: previewUrl,
    text_url: null,
    remote_url: null,
    meta: {
      original: mediaMeta(media.original.metaData),
      ...(media.thumbnail ? { small: mediaMeta(media.thumbnail.metaData) } : {})
    },
    description: media.description ?? ''
  })
}
