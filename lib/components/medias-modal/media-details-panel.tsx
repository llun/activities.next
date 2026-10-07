import { Camera, MapPin } from 'lucide-react'
import { FC } from 'react'

import type { MediaPublicDetails } from '@/lib/services/gallery/galleryEntities'

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
}

// Compact, read-only summary of a photo's public details, shown under the
// viewer's alt text. Renders nothing when none of the details are present.
export const MediaDetailsPanel: FC<Props> = ({ details }) => {
  const subjectName = details.subject?.name?.trim() || null
  const scientificName = details.subject?.scientificName?.trim() || null
  const category = details.subject?.category ?? null
  const gear = [details.camera?.name, details.lens?.name].filter(
    (name): name is string => Boolean(name)
  )
  const exposure = details.exposure ? formatExposure(details.exposure) : null
  const place = formatPlace(details.place)
  const takenAt = formatTakenAt(details.takenAt)

  const hasSubject = Boolean(subjectName || scientificName || category)
  if (!hasSubject && gear.length === 0 && !exposure && !place && !takenAt) {
    return null
  }

  return (
    <div
      onTouchStart={(e) => e.stopPropagation()}
      className="mt-2 max-w-2xl space-y-1 px-4 text-center text-xs leading-relaxed text-white/75 select-text"
    >
      {hasSubject && (
        <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-sm text-white/90">
          {subjectName && <span className="font-semibold">{subjectName}</span>}
          {scientificName && (
            <span className="italic text-white/60">{scientificName}</span>
          )}
          {category && (
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[0.7rem] capitalize">
              {category}
            </span>
          )}
        </p>
      )}
      {gear.length > 0 && (
        <p className="flex items-center justify-center gap-1.5">
          <Camera className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{gear.join(' · ')}</span>
        </p>
      )}
      {exposure && <p>{exposure}</p>}
      {place && (
        <p className="flex items-center justify-center gap-1.5">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{place}</span>
        </p>
      )}
      {takenAt && <p>{takenAt}</p>}
    </div>
  )
}
