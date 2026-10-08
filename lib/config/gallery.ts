import { PHASE_PRODUCTION_BUILD } from 'next/dist/shared/lib/constants'
import { z } from 'zod'

import { logger } from '@/lib/utils/logger'

import { AltTextConfig } from './altText'

export const DEFAULT_GBIF_ENDPOINT = 'https://api.gbif.org/v1'
export const DEFAULT_NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org'

export const GalleryLookupConfig = z.object({
  // The vision model that suggests a photo's subject. Reuses the alt text
  // endpoint and key; null when alt text is not configured or the operator
  // turned subject suggestions off.
  subjects: z
    .object({
      endpoint: z.string(),
      apiKey: z.string(),
      model: z.string()
    })
    .nullable(),
  gbif: z.object({ endpoint: z.string() }),
  nominatim: z.object({
    endpoint: z.string(),
    // Sent as the `email` parameter, per the Nominatim usage policy.
    email: z.string().nullable()
  })
})
export type GalleryLookupConfig = z.infer<typeof GalleryLookupConfig>

// An endpoint must be an https URL without credentials. Anything else logs one
// warning and falls back to the public default; it never throws, so a typo
// cannot take the server (or `next build`) down for an optional integration.
const readEndpoint = (name: string, fallback: string): string => {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback

  try {
    const url = new URL(raw)
    if (url.protocol === 'https:' && !url.username && !url.password) {
      return raw.replace(/\/+$/, '')
    }
  } catch {
    // Falls through to the warning below.
  }

  if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) {
    logger.warn({
      message: `${name} must be an https URL without credentials; using the default ${fallback}`
    })
  }
  return fallback
}

export const getGalleryConfig = (
  altText: AltTextConfig | null | undefined
): { gallery: GalleryLookupConfig } => {
  const subjectsOff =
    process.env.ACTIVITIES_GALLERY_SUBJECTS?.trim().toLowerCase() === 'off'
  const modelOverride = process.env.ACTIVITIES_GALLERY_SUBJECTS_MODEL?.trim()
  const email = process.env.ACTIVITIES_GALLERY_NOMINATIM_EMAIL?.trim()

  return {
    gallery: {
      subjects:
        altText && !subjectsOff
          ? {
              endpoint: altText.endpoint,
              apiKey: altText.apiKey,
              model: modelOverride || altText.model
            }
          : null,
      gbif: {
        endpoint: readEndpoint(
          'ACTIVITIES_GALLERY_GBIF_ENDPOINT',
          DEFAULT_GBIF_ENDPOINT
        )
      },
      nominatim: {
        endpoint: readEndpoint(
          'ACTIVITIES_GALLERY_NOMINATIM_ENDPOINT',
          DEFAULT_NOMINATIM_ENDPOINT
        ),
        email: email || null
      }
    }
  }
}
