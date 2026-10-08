import { z } from 'zod'

import {
  GALLERY_ALBUM_SORTS,
  GALLERY_ALBUM_VISIBILITIES,
  MAX_GALLERY_ALBUM_DESCRIPTION_LENGTH,
  MAX_GALLERY_ALBUM_REQUEST_IDS,
  MAX_GALLERY_ALBUM_TITLE_LENGTH
} from '@/lib/types/database/galleryAlbums'

// A media id on the wire: the decimal `medias.id`.
const MediaId = z.string().trim().regex(/^\d+$/).max(10)

// 1 to 100 media ids; repeats are harmless (they are de-duplicated).
const MediaIds = z.array(MediaId).min(1).max(MAX_GALLERY_ALBUM_REQUEST_IDS)

const Title = z.string().trim().min(1).max(MAX_GALLERY_ALBUM_TITLE_LENGTH)

// Blank clears it, on create and update alike.
const Description = z
  .string()
  .trim()
  .max(MAX_GALLERY_ALBUM_DESCRIPTION_LENGTH)
  .transform((value) => value || null)

export const CreateGalleryAlbumRequest = z.object({
  title: Title,
  description: Description.nullish(),
  visibility: z.enum(GALLERY_ALBUM_VISIBILITIES).optional(),
  sort_order: z.enum(GALLERY_ALBUM_SORTS).optional(),
  // Photos to start the album with (the first 100; the client adds the rest).
  media_ids: MediaIds.optional()
})
export type CreateGalleryAlbumRequest = z.infer<
  typeof CreateGalleryAlbumRequest
>

// Every field is optional: an absent key leaves the album alone. `null` clears
// the description and the explicit cover.
export const UpdateGalleryAlbumRequest = z
  .object({
    title: Title.optional(),
    description: Description.nullish(),
    visibility: z.enum(GALLERY_ALBUM_VISIBILITIES).optional(),
    sort_order: z.enum(GALLERY_ALBUM_SORTS).optional(),
    cover_media_id: MediaId.nullable().optional()
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { message: 'At least one field is required' }
  )
export type UpdateGalleryAlbumRequest = z.infer<
  typeof UpdateGalleryAlbumRequest
>

export const GalleryAlbumItemsRequest = z.object({ media_ids: MediaIds })
export type GalleryAlbumItemsRequest = z.infer<typeof GalleryAlbumItemsRequest>

// Opaque to clients: `<sort key>:<media id>`, as `GalleryAlbumMediaPage`
// hands it out.
export const GALLERY_ALBUM_CURSOR_PATTERN = /^-?\d{1,16}:\d{1,10}$/

export const GalleryAlbumItemsQuery = z.object({
  max_id: z.string().regex(GALLERY_ALBUM_CURSOR_PATTERN).optional(),
  sort: z.enum(GALLERY_ALBUM_SORTS).optional(),
  subject: z.string().trim().min(1).max(520).optional()
})
