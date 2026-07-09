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

// Maps a stored mime type to a Mastodon MediaAttachment `type`. We don't detect
// animated GIFs, so we never emit `gifv`; anything that isn't image/video/audio
// is reported as `unknown`.
// https://docs.joinmastodon.org/entities/MediaAttachment/#type
const mediaType = (mimeType: string): MediaType => {
  if (mimeType.startsWith('video')) return MediaType.enum.video
  if (mimeType.startsWith('audio')) return MediaType.enum.audio
  if (mimeType.startsWith('image')) return MediaType.enum.image
  return MediaType.enum.unknown
}

// Builds the Mastodon MediaAttachment entity for an already-stored media row.
// Both the local-file and S3 storages serve files through `/api/v1/files/:path`,
// so the public URL can be reconstructed without going back through the storage
// driver. This is the single source of truth for the entity shape — the upload
// paths (LocalFile/S3 saveFile) and the GET/PUT/PATCH /api/v1/media/:id routes
// all build their response body here so every field stays consistent.
export const getMediaAttachment = (
  media: Media,
  host: string
): MediaStorageSaveFileOutput => {
  const protocol = isLocalHost(host) ? 'http' : 'https'
  const url = `${protocol}://${host}/api/v1/files/${media.original.path}`
  const previewUrl = media.thumbnail
    ? `${protocol}://${host}/api/v1/files/${media.thumbnail.path}`
    : url

  return MediaStorageSaveFileOutput.parse({
    id: `${media.id}`,
    type: mediaType(media.original.mimeType),
    mime_type: media.original.mimeType,
    url,
    preview_url: previewUrl,
    text_url: null,
    remote_url: null,
    preview_remote_url: null,
    meta: {
      original: mediaMeta(media.original.metaData),
      ...(media.thumbnail
        ? { small: mediaMeta(media.thumbnail.metaData) }
        : {}),
      ...(media.focus ? { focus: media.focus } : {})
    },
    // Mastodon emits null (not '') when no alt text is set; '' from legacy rows
    // is normalised to null too.
    description: media.description || null,
    blurhash: null
  })
}
