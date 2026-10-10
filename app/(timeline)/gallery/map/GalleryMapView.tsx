'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useId, useMemo, useRef, useState } from 'react'

import { getGalleryMap } from '@/lib/client'
import { GalleryMap } from '@/lib/components/gallery/GalleryMap'
import { formatGalleryMapSummary } from '@/lib/components/gallery/galleryTaxonomy'
import { PageHeader } from '@/lib/components/page-header'
import { Alert } from '@/lib/components/surface/Alert'
import { Label } from '@/lib/components/ui/label'
import { Select } from '@/lib/components/ui/select'
import { Switch } from '@/lib/components/ui/switch'
import type { GalleryMapPoint } from '@/lib/services/gallery/galleryEntities'
import { getActorMentionPathSegment } from '@/lib/utils/getActorMentionPathSegment'
import type { PublicMapProvider } from '@/lib/utils/mapProvider'

interface Props {
  /** The signed-in owner's actor id, for the public-preview request. */
  actorId: string
  username: string
  domain: string
  initialPoints: GalleryMapPoint[]
  initialTruncated: boolean
  /** Whether visitors can see the map at all (`mapPublic`). */
  mapPublic: boolean
  mapProvider: PublicMapProvider
}

const ALL_SUBJECTS = ''

/**
 * The owner's map: every photo with a place at its stored position, a subject
 * filter, and a "Preview public map" switch that swaps in exactly what a
 * logged-out visitor gets. Pages are owner-only, so the first paint comes from
 * the server; only the preview is fetched.
 */
export const GalleryMapView: FC<Props> = ({
  actorId,
  username,
  domain,
  initialPoints,
  initialTruncated,
  mapPublic,
  mapProvider
}) => {
  const router = useRouter()
  const subjectId = useId()
  const [subject, setSubject] = useState(ALL_SUBJECTS)
  const [isPreview, setIsPreview] = useState(false)
  const [preview, setPreview] = useState<{
    points: GalleryMapPoint[]
    truncated: boolean
  } | null>(null)
  // `null` after a settled preview request means the public map is switched off.
  const [previewSettled, setPreviewSettled] = useState(false)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewRequest = useRef(0)

  useEffect(() => {
    // A private map answers the preview with a 404: no need to ask.
    if (!isPreview || previewSettled || !mapPublic) return
    const request = ++previewRequest.current
    setIsLoadingPreview(true)
    setPreviewError(null)
    getGalleryMap(actorId, { previewPublic: true }).then(
      (response) => {
        if (request !== previewRequest.current) return
        setPreview(response)
        setPreviewSettled(true)
        setIsLoadingPreview(false)
      },
      () => {
        if (request !== previewRequest.current) return
        setPreviewError('Failed to load the public preview.')
        setIsPreview(false)
        setIsLoadingPreview(false)
      }
    )
    return () => {
      // The response of a request this cleanup abandons is ignored, so it
      // must also clear the busy flag it would have cleared.
      previewRequest.current += 1
      setIsLoadingPreview(false)
    }
  }, [actorId, isPreview, previewSettled, mapPublic])

  const shown =
    isPreview && previewSettled && preview
      ? { points: preview.points, truncated: preview.truncated }
      : { points: initialPoints, truncated: initialTruncated }

  const subjects = useMemo(
    () =>
      [
        ...new Set(
          shown.points.flatMap((point) =>
            point.subjectName ? [point.subjectName] : []
          )
        )
      ].sort((left, right) => left.localeCompare(right)),
    [shown.points]
  )
  // A filter on a subject the other dataset lacks must not leave the map empty
  // behind a select that offers nothing.
  const activeSubject = subjects.includes(subject) ? subject : ALL_SUBJECTS
  const visiblePoints = useMemo(
    () =>
      activeSubject === ALL_SUBJECTS
        ? shown.points
        : shown.points.filter((point) => point.subjectName === activeSubject),
    [shown.points, activeSubject]
  )

  // Distinct countries of the points on the map. The owner's own points carry
  // their stored codes; the preview's are the public projection's, so a
  // withheld place adds none. Null (left out of the summary) when none has one.
  const countryCount = useMemo(() => {
    const codes = new Set(
      visiblePoints.flatMap((point) =>
        point.countryCode ? [point.countryCode] : []
      )
    )
    return codes.size > 0 ? codes.size : null
  }, [visiblePoints])

  // Every owner point the public map would not show: a precision it never
  // shows, a threatened species' place, a hidden location, or a photo only on
  // non-public posts.
  const hiddenFromPublic = initialPoints.filter(
    (point) =>
      point.publicState === 'not-shown' ||
      point.publicState === 'not-public-post' ||
      point.publicState === 'threatened-species' ||
      point.publicState === 'in-hidden-location'
  ).length
  const hiddenThreatened = initialPoints.filter(
    (point) => point.publicState === 'threatened-species'
  ).length
  const isPublicPreviewOff =
    isPreview && (!mapPublic || (previewSettled && preview === null))

  const openPhoto = (mediaId: string) => {
    const point = shown.points.find((entry) => entry.mediaId === mediaId)
    // An unposted photo has no post to open.
    if (!point?.statusId) return
    router.push(
      `/${getActorMentionPathSegment({ username, domain })}/${encodeURIComponent(point.statusId)}`
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Map"
        description={formatGalleryMapSummary(
          visiblePoints.length,
          countryCount
        )}
      />

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <Label htmlFor={subjectId} className="sr-only">
            Subject
          </Label>
          <Select
            id={subjectId}
            className="w-56"
            value={activeSubject}
            onChange={(event) => setSubject(event.target.value)}
          >
            <option value={ALL_SUBJECTS}>All subjects</option>
            {subjects.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="gallery-map-preview"
            checked={isPreview}
            aria-busy={isLoadingPreview}
            onCheckedChange={setIsPreview}
          />
          <Label htmlFor="gallery-map-preview" className="cursor-pointer">
            Preview public map
          </Label>
        </div>
      </div>

      {previewError ? (
        <Alert title={previewError}>Try the switch again.</Alert>
      ) : null}

      {isPreview && mapPublic && isLoadingPreview ? (
        <div className="skeleton h-[420px] rounded-lg" aria-busy="true" />
      ) : isPublicPreviewOff ? (
        <Alert title="Your map is private">
          Visitors see no map until you switch on Public map in{' '}
          <Link className="underline" href="/gallery/privacy">
            Gallery privacy
          </Link>
          .
        </Alert>
      ) : (
        <>
          {isPreview ? (
            <p role="status" className="text-muted-foreground text-sm">
              This is what visitors see: places at the precision you allow,
              nothing inside your hidden locations.
            </p>
          ) : hiddenFromPublic > 0 ? (
            <p className="text-muted-foreground text-sm">
              {hiddenFromPublic.toLocaleString('en-US')}{' '}
              {hiddenFromPublic === 1 ? 'item is' : 'items are'} not shown on
              the public map
              {hiddenThreatened > 0
                ? `, ${hiddenThreatened.toLocaleString('en-US')} because of threatened-species hiding`
                : ''}
              .
            </p>
          ) : null}
          {shown.truncated ? (
            <p className="text-muted-foreground text-sm">
              Showing the newest photos and videos only.
            </p>
          ) : null}
          <GalleryMap
            points={visiblePoints}
            mapProvider={mapProvider}
            onSelect={openPhoto}
          />
        </>
      )}
    </div>
  )
}
