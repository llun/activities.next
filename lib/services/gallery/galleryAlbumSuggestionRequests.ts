import { z } from 'zod'

import { isNamedTimeZone } from '@/lib/fitness/calendar/localDay'
import { MAX_GALLERY_ALBUM_REQUEST_IDS } from '@/lib/types/database/galleryAlbums'

// A media id on the wire: the decimal `medias.id`.
const MediaId = z.string().trim().regex(/^\d+$/).max(10)

// `GET /api/v1/gallery/albums/suggestions?time_zone=`: the viewer's named IANA
// zone (what the browser reports), used to say which local day a photo was
// taken on and which a recorded activity falls on. Absent means UTC.
export const GalleryAlbumSuggestionsQuery = z.object({
  time_zone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine(isNamedTimeZone, { message: 'Unknown time zone' })
    .optional()
})

// `GET /api/v1/gallery/albums/suggestions/media?media_ids=1,2,3`: 1 to 100
// comma-separated media ids.
export const GalleryAlbumSuggestionMediaQuery = z.object({
  media_ids: z
    .string()
    .max(MAX_GALLERY_ALBUM_REQUEST_IDS * 11)
    .transform((value) => value.split(','))
    .pipe(z.array(MediaId).min(1).max(MAX_GALLERY_ALBUM_REQUEST_IDS))
})
