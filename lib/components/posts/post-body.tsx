'use client'

import { Activity, ExternalLink } from 'lucide-react'
import { FC } from 'react'

import { Alert } from '@/lib/components/surface/Alert'
import { StatStrip } from '@/lib/components/surface/StatStrip'
import type { Actor } from '@/lib/types/database'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { isRenderableAttachment } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import {
  formatFitnessDistance,
  formatFitnessDuration,
  formatFitnessElevation,
  getFitnessPaceOrSpeed,
  getFitnessSourceLabel,
  normalizeFitnessSourceUrl
} from '@/lib/utils/fitness'
import { getDeviceDisplayLabel } from '@/lib/utils/fitnessDeviceBrands'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import {
  getActualStatus,
  processStatusText
} from '@/lib/utils/text/processStatusText'

import { BrandedDeviceLink } from './BrandedDeviceLink'
import { Attachments, OnMediaSelectedHandle } from './attachments'
import { CollapsibleContent } from './collapsible-content'
import { ContentWarning } from './content-warning'
import { FitnessProcessingProgress } from './fitness-processing-progress'
import { LinkPreviewCard } from './link-preview-card'
import { Poll } from './poll'
import { QuoteCard } from './quote-card'
import { RetryFitnessButton } from './retry-fitness-button'
import { TranslateContent } from './translate-content'

/**
 * What a post's `TranslationProvider` is given. Only signed-in viewers are
 * offered translation (the API needs a token); this keeps the public landing
 * feed free of dead Translate buttons. The content-detected language is
 * preferred over the declared one: a post mislabeled (or defaulted) to the
 * viewer's language but actually written in another one would otherwise never
 * offer the control, and a post mislabeled the other way would show a dead
 * en→en-equivalent button. See lib/services/language-detection.
 */
export const getPostTranslation = (
  actualStatus: StatusNote | StatusPoll,
  hasViewer: boolean,
  currentActorId?: string
) => ({
  isTranslatable: hasViewer,
  // The author's own posts never carry the inline Translate control (it would
  // sit under a post they just wrote in their own language); they can still
  // translate one from the post menu.
  inlineTranslation: !(
    currentActorId && currentActorId === actualStatus.actorId
  ),
  translationLanguage: hasViewer
    ? (actualStatus.detectedLanguage ?? actualStatus.language)
    : null
})

interface PostBodyProps {
  host: string
  currentTime: number
  /** The row's status (the Announce wrapper for a boost). */
  status: Status
  currentActor?: ActorProfile | Actor
  collapsible?: boolean
  postLineLimit?: PostLineLimit
  onShowAttachment?: OnMediaSelectedHandle
  /** Reveal this post's first picture without the hydration fade (eager only where it would otherwise be lazy). */
  prioritizeMedia?: boolean
}

/**
 * Everything a post shows under its header: the content (behind its content
 * warning), a fitness activity, poll, media, link preview and quote card. Must
 * render inside the post's `TranslationProvider`. Shared by `Post` and the
 * timeline's combined posts, which stack several of these under one header.
 */
export const PostBody: FC<PostBodyProps> = ({
  host,
  currentTime,
  status,
  currentActor,
  collapsible,
  postLineLimit,
  onShowAttachment = () => {},
  prioritizeMedia = false
}) => {
  const actualStatus = getActualStatus(status)
  const processedAndCleanedText = cleanClassName(
    processStatusText(host, actualStatus),
    {
      // Mastodon client contract: when the quote renders structurally (the
      // QuoteCard below renders for every edge state, tombstones included),
      // the in-content "RE: <link>" fallback is redundant and is hidden.
      // With no edge the fallback is the reader's only clue and stays
      // visible.
      hideQuoteInline: Boolean(actualStatus.quote),
      host,
      tags: actualStatus.tags
    }
  )
  const fitnessFile =
    actualStatus.type === StatusType.enum.Note ? actualStatus.fitness : null
  const fitnessProcessingStatus = fitnessFile?.processingStatus ?? 'completed'
  // A file left in `processing` long after its worker died (server computes
  // `processingStuck`) is surfaced as a retry instead of an endless spinner.
  const isFitnessStuck = Boolean(fitnessFile?.processingStuck)
  const isFitnessProcessing =
    !isFitnessStuck &&
    (fitnessProcessingStatus === 'pending' ||
      fitnessProcessingStatus === 'processing')
  const isFitnessFailed = fitnessProcessingStatus === 'failed' || isFitnessStuck
  const fitnessRetryVariant: 'failed' | 'stuck' =
    fitnessProcessingStatus === 'failed' ? 'failed' : 'stuck'
  const isFitnessCompleted = fitnessProcessingStatus === 'completed'
  // What is wrong with the route map of an otherwise complete activity. The
  // activity itself is intact — stats, charts, attachments and federation are
  // unaffected — so this is a quiet owner-only retry, not the destructive
  // "Processing failed" banner every viewer sees. The copy differs per kind
  // because the post looks different in each: no map at all, or the previous
  // map still shown because the run that should have replaced it failed. Saying
  // "could not be generated" above a rendered map is how an owner concludes the
  // feature is lying.
  const fitnessMapFailure = isFitnessCompleted
    ? fitnessFile?.mapFailure
    : undefined
  const fitnessMapRetryVariant = fitnessMapFailure
    ? (`map-${fitnessMapFailure}` as const)
    : undefined
  const fitnessDistance = formatFitnessDistance(
    fitnessFile?.totalDistanceMeters
  )
  const fitnessDuration = formatFitnessDuration(
    fitnessFile?.totalDurationSeconds
  )
  const fitnessElevation = formatFitnessElevation(
    fitnessFile?.elevationGainMeters
  )
  const fitnessPaceOrSpeed = getFitnessPaceOrSpeed({
    distanceMeters: fitnessFile?.totalDistanceMeters,
    durationSeconds: fitnessFile?.totalDurationSeconds,
    movingTimeSeconds: fitnessFile?.movingTimeSeconds,
    activityType: fitnessFile?.activityType
  })
  const fitnessSourceUrl = normalizeFitnessSourceUrl(fitnessFile?.sourceUrl)
  // The gear row's name overrides the recorded one, so the Via: line renders
  // whenever EITHER is present — a device the owner renamed to something the
  // brand map cannot resolve would otherwise disappear from the post.
  const fitnessDeviceLabel =
    fitnessFile?.deviceGearName?.trim() ||
    getDeviceDisplayLabel(
      fitnessFile?.deviceName,
      fitnessFile?.deviceManufacturer
    )
  // Gear rides along with the distance rather than taking a cell or a row of
  // its own: the design shows "42.6 km · Moots". With no distance there is
  // nothing to append it to, so it is simply not shown.
  const fitnessGearName = fitnessFile?.gearName?.trim()
  const fitnessDistanceWithGear =
    fitnessDistance && fitnessGearName
      ? `${fitnessDistance} · ${fitnessGearName}`
      : fitnessDistance
  // Labeled stat cells for the 4-up grid, in the design's order, dropping any
  // metric the file doesn't provide.
  const fitnessStats = [
    { label: 'Distance', value: fitnessDistanceWithGear },
    { label: 'Duration', value: fitnessDuration },
    fitnessPaceOrSpeed
      ? { label: fitnessPaceOrSpeed.label, value: fitnessPaceOrSpeed.value }
      : null,
    { label: 'Elevation', value: fitnessElevation }
  ].filter((stat): stat is { label: string; value: string } =>
    Boolean(stat?.value)
  )
  const isOwner =
    Boolean(actualStatus.isLocalActor) &&
    currentActor?.id === actualStatus.actorId
  const summary = actualStatus.summary?.trim()

  const { translationLanguage, inlineTranslation } = getPostTranslation(
    actualStatus,
    Boolean(currentActor),
    currentActor?.id
  )
  const statusBody = (
    <>
      <TranslateContent
        statusId={actualStatus.id}
        language={translationLanguage}
        inline={inlineTranslation}
        contentClassName="mt-1 text-sm leading-relaxed break-words markdown-content"
      >
        {collapsible && postLineLimit !== 0 && !summary ? (
          <CollapsibleContent
            className="mt-1 text-sm leading-relaxed break-words"
            contentClassName="markdown-content"
            maxLines={postLineLimit}
          >
            {processedAndCleanedText}
          </CollapsibleContent>
        ) : (
          <div className="mt-1 text-sm leading-relaxed break-words markdown-content">
            {processedAndCleanedText}
          </div>
        )}
      </TranslateContent>
      {fitnessFile ? (
        <div className="mt-2 max-w-full rounded-lg border bg-background p-3 text-xs">
          <div className="flex max-w-full items-center gap-2">
            <Activity className="size-4 shrink-0 text-primary" />
            {/* The visible "Fitness" label was dropped in the redesign; keep the
                activity semantic for screen readers. */}
            <span className="sr-only">Fitness activity</span>
            {/* The download is owner-only: `fitnessFile.url` serves the ORIGINAL
                upload, which still holds the ends a privacy location trims off
                the route map and the route data, so the endpoint 404s for
                everyone else and a link here would only ever 404. The name stays
                for every viewer — it is this card's label, not the link's text. */}
            {isOwner ? (
              <a
                href={fitnessFile.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate font-mono text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                title={fitnessFile.fileName}
              >
                {fitnessFile.fileName}
              </a>
            ) : (
              <span
                className="truncate font-mono text-xs text-muted-foreground"
                title={fitnessFile.fileName}
              >
                {fitnessFile.fileName}
              </span>
            )}
            <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {fitnessFile.fileType}
            </span>
          </div>

          {isFitnessProcessing ? (
            <FitnessProcessingProgress
              statusId={actualStatus.id}
              initialProcessingStatus={fitnessProcessingStatus}
            />
          ) : null}

          {isFitnessFailed ? (
            isOwner ? (
              <RetryFitnessButton
                statusId={actualStatus.id}
                variant={fitnessRetryVariant}
              />
            ) : (
              <Alert
                className="mt-2"
                tone={fitnessRetryVariant === 'stuck' ? 'warning' : 'error'}
                live={false}
                title={
                  fitnessRetryVariant === 'stuck'
                    ? 'Processing is taking longer than expected. The original activity file is still available.'
                    : 'Processing failed. The original activity file is still available.'
                }
              />
            )
          ) : null}

          {fitnessMapRetryVariant && isOwner ? (
            <RetryFitnessButton
              statusId={actualStatus.id}
              variant={fitnessMapRetryVariant}
            />
          ) : null}

          {isFitnessCompleted && fitnessStats.length > 0 ? (
            <StatStrip variant="chip" className="mt-2.5">
              {fitnessStats.map((stat) => (
                // `min-w-0` + `truncate`: the Distance cell carries the gear
                // name too, and `fitness_gears.name` is a varchar(255) whose
                // one unbroken token would otherwise push this quarter-width
                // grid column past the card. The full text stays in `title`.
                <div key={stat.label} className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[11px] text-muted-foreground">
                    {stat.label}
                  </span>
                  <span
                    className="truncate text-sm font-semibold text-foreground"
                    title={stat.value}
                  >
                    {stat.value}
                  </span>
                </div>
              ))}
            </StatStrip>
          ) : null}

          {isFitnessCompleted && fitnessDeviceLabel ? (
            <div className="mt-2 text-[11px] text-muted-foreground">
              Via:{' '}
              <BrandedDeviceLink
                deviceName={fitnessFile.deviceName}
                deviceManufacturer={fitnessFile.deviceManufacturer}
                deviceGearId={fitnessFile.deviceGearId}
                deviceGearName={fitnessFile.deviceGearName}
                isOwner={isOwner}
              />
            </div>
          ) : null}

          {fitnessSourceUrl ? (
            <div className="mt-2">
              <a
                href={fitnessSourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                <ExternalLink className="size-3.5 shrink-0" />
                {getFitnessSourceLabel(fitnessSourceUrl)}
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      <Poll
        status={actualStatus}
        currentTime={currentTime}
        currentActorId={currentActor?.id}
      />
      <Attachments
        status={actualStatus}
        onMediaSelected={onShowAttachment}
        prioritizeMedia={prioritizeMedia}
      />
      {/* The link card yields to any richer representation of what the post is
          about — media, a quoted post, or a fitness activity — rather than
          stacking a second block under it. This is the display rule Mastodon
          applies; the card is still stored and still served over the API, so a
          client is free to decide otherwise.
          The fitness clause reads `fitnessFile`, the same value the chip above
          is gated on, rather than `actualStatus.fitness` — so it yields only
          when a chip is actually on screen to yield to, instead of to the mere
          presence of a fitness row. The media clause asks the same question of
          the attachments for the same reason: `Attachments` skips anything
          `Media` renders as nothing, so a bare `.length` would yield the card
          to a PDF that puts no block on screen to yield to. */}
      {actualStatus.linkPreview &&
      !actualStatus.quote &&
      !fitnessFile &&
      !actualStatus.attachments.some(isRenderableAttachment) ? (
        <LinkPreviewCard linkPreview={actualStatus.linkPreview} />
      ) : null}
      {actualStatus.quote ? (
        <QuoteCard quote={actualStatus.quote} currentTime={currentTime} />
      ) : null}
    </>
  )

  return summary ? (
    <ContentWarning summary={summary} tags={actualStatus.tags}>
      {statusBody}
    </ContentWarning>
  ) : (
    statusBody
  )
}
