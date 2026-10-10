import { formatDistanceToNowStrict } from 'date-fns/formatDistanceToNowStrict'
import { Camera, MapPin } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import {
  formatTaxonPath,
  getHashtagHref,
  toScientificHashtag
} from '@/lib/components/gallery/galleryTaxonomy'
import type { MediaPublicDetails } from '@/lib/services/gallery/galleryEntities'
import { cn } from '@/lib/utils'

type Exposure = NonNullable<MediaPublicDetails['exposure']>

const takenAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium'
})

const formatTakenAt = (takenAt: string | null): string | null => {
  if (!takenAt) return null
  const date = new Date(takenAt)
  if (Number.isNaN(date.getTime())) return null
  return takenAtFormatter.format(date)
}

const formatExposure = (exposure: Exposure): string | null => {
  const parts = [
    exposure.focalLengthMm != null ? `${exposure.focalLengthMm} mm` : null,
    exposure.aperture != null ? `f/${exposure.aperture}` : null,
    exposure.exposureTime ? `${exposure.exposureTime} s` : null,
    exposure.iso != null ? `ISO ${exposure.iso}` : null
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : null
}

const formatPlace = (place: MediaPublicDetails['place']): string | null => {
  if (!place?.name) return null
  if (place.precision === 'area') return `${place.name} · within 5 km`
  if (place.precision === 'country') return `${place.name} (approximate)`
  return place.name
}

interface Props {
  details: MediaPublicDetails
  /**
   * The photo's owner, when the viewer knows it. Every subject the public
   * details carry was confirmed by the owner (suggestions are never applied
   * without them), so with a name the category line reads "Bird · confirmed
   * by <name>".
   */
  ownerName?: string | null
  /**
   * `updatedAt` of the attachment being viewed. The "Edited" row shows only
   * when the attachment is not older than the edit.
   */
  attachmentUpdatedAt?: number | null
  className?: string
}

// `editedAt` arrives with the photo editor's server half; read it through a
// narrow type so this file compiles with or without that field on the entity.
type WithEditedAt = { editedAt?: string | null }

/**
 * When the photo was edited, if THIS attachment shows the edit. A post that
 * chose "Gallery only" keeps the old file, so its attachment is older than the
 * edit and must not claim the photo was edited.
 */
const getShownEditedAt = (
  details: MediaPublicDetails,
  attachmentUpdatedAt?: number | null
): Date | null => {
  const editedAt = (details as WithEditedAt).editedAt
  if (!editedAt) return null
  const time = Date.parse(editedAt)
  if (Number.isNaN(time)) return null
  if (attachmentUpdatedAt != null && attachmentUpdatedAt < time) return null
  return new Date(time)
}

const summarize = (
  details: MediaPublicDetails,
  attachmentUpdatedAt?: number | null
) => {
  const editedAt = getShownEditedAt(details, attachmentUpdatedAt)
  const subjectName = details.subject?.name?.trim() || null
  const scientificName = details.subject?.scientificName?.trim() || null
  const category = details.subject?.category ?? null
  const taxonPath = formatTaxonPath(details.subject?.taxonPath)
  const scientificTag = toScientificHashtag(scientificName)
  const gear = [details.camera?.name, details.lens?.name].filter(
    (name): name is string => Boolean(name)
  )
  const exposure = details.exposure ? formatExposure(details.exposure) : null
  const place = formatPlace(details.place)
  const takenAt = formatTakenAt(details.takenAt)
  const hasSubject = Boolean(subjectName || scientificName || category)
  const hasContent =
    hasSubject ||
    gear.length > 0 ||
    Boolean(exposure || place || takenAt || editedAt)
  return {
    editedAt,
    subjectName,
    scientificName,
    category,
    taxonPath,
    scientificTag,
    gear,
    exposure,
    place,
    takenAt,
    hasSubject,
    hasContent
  }
}

// True when the panel would render something. The viewer uses it to decide
// whether there is anything to show, so it must match the panel exactly.
export const hasPublicDetailsContent = (
  details: MediaPublicDetails | null | undefined,
  attachmentUpdatedAt?: number | null
): details is MediaPublicDetails =>
  details != null && summarize(details, attachmentUpdatedAt).hasContent

// Compact, read-only summary of a photo's public details, shown in the
// viewer's info overlay. Renders nothing when none of the details are present.
export const MediaDetailsPanel: FC<Props> = ({
  details,
  ownerName,
  attachmentUpdatedAt,
  className
}) => {
  const {
    editedAt,
    subjectName,
    scientificName,
    category,
    taxonPath,
    scientificTag,
    gear,
    exposure,
    place,
    takenAt,
    hasSubject,
    hasContent
  } = summarize(details, attachmentUpdatedAt)

  if (!hasContent) return null

  return (
    <div
      onTouchStart={(e) => e.stopPropagation()}
      className={cn(
        'space-y-1 text-left text-xs leading-relaxed text-white/75 select-text',
        className
      )}
    >
      {hasSubject && (
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-white/90">
          {subjectName && <span className="font-semibold">{subjectName}</span>}
          {scientificName && (
            <span className="italic text-white/60">{scientificName}</span>
          )}
          {category && !ownerName && (
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[0.7rem] capitalize">
              {category}
            </span>
          )}
        </p>
      )}
      {taxonPath && <p className="text-white/60">{taxonPath}</p>}
      {hasSubject && ownerName && (
        <p>
          {category && <span className="capitalize">{category} · </span>}
          confirmed by {ownerName}
        </p>
      )}
      {scientificTag && (
        <p>
          <Link
            href={getHashtagHref(scientificTag)}
            prefetch={false}
            className="underline underline-offset-2 hover:text-white"
          >
            #{scientificTag}
          </Link>{' '}
          on the fediverse
        </p>
      )}
      {gear.length > 0 && (
        <p className="flex items-center gap-1.5">
          <Camera className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{gear.join(' · ')}</span>
        </p>
      )}
      {exposure && <p>{exposure}</p>}
      {place && (
        <p className="flex items-center gap-1.5">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{place}</span>
        </p>
      )}
      {takenAt && <p>{takenAt}</p>}
      {editedAt && (
        <p>
          Edited{' '}
          <time dateTime={editedAt.toISOString()}>
            {formatDistanceToNowStrict(editedAt, { addSuffix: true })}
          </time>
        </p>
      )}
    </div>
  )
}
