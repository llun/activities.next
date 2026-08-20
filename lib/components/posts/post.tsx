'use client'

import { formatDistance } from 'date-fns'
import _ from 'lodash'
import { Activity, ExternalLink, Repeat2 } from 'lucide-react'
import { FC } from 'react'

import { FitnessStatGrid } from '@/lib/components/fitness/FitnessStatGrid'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import {
  EditableStatus,
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import type { StatusReaction } from '@/lib/types/mastodon/statusReaction'
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
import { Actions } from './actions/actions'
import { ActorAvatar, ActorInfo, getActorIdMention } from './actor'
import { Attachments, OnMediaSelectedHandle } from './attachments'
import { CollapsibleContent } from './collapsible-content'
import { ContentWarning } from './content-warning'
import { FitnessProcessingProgress } from './fitness-processing-progress'
import { LinkPreviewCard } from './link-preview-card'
import { Poll } from './poll'
import { QuoteCard } from './quote-card'
import { ReactionRow } from './reaction-row'
import { ReadOnlyStats } from './read-only-stats'
import { RetryFitnessButton } from './retry-fitness-button'
import { TranslateContent } from './translate-content'
import { TranslationProvider } from './translation-context'
import { useReactionState } from './useReactionState'

export interface PostProps {
  host: string
  currentActor?: ActorProfile
  currentTime: number
  status: Status
  editable?: boolean
  showActions?: boolean
  /**
   * Render a non-interactive engagement row (reply/boost/like counts) in place
   * of the action buttons. Used for read-only previews such as the logged-out
   * landing feed. Ignored when `showActions` is on.
   */
  showReadOnlyStats?: boolean
  onReply?: (status: Status) => void
  onEdit?: (status: EditableStatus) => void
  onQuote?: (status: Status) => void
  onPostDeleted?: (status: Status) => void
  onBookmarkChanged?: (
    status: StatusNote | StatusPoll,
    isBookmarked: boolean
  ) => void
  onLikeChanged?: (status: StatusNote | StatusPoll, isLiked: boolean) => void
  onReactionsChanged?: (
    status: StatusNote | StatusPoll,
    reactions: StatusReaction[]
  ) => void
  onOpenStatus?: (status: Status) => void
  onShowAttachment: OnMediaSelectedHandle
  collapsible?: boolean
  postLineLimit?: PostLineLimit
}

interface BoostStatusProps {
  status: Status
}

export const BoostStatus: FC<BoostStatusProps> = ({ status }) => {
  if (status.type !== StatusType.enum.Announce) return null
  const actorName =
    status.actor?.name ||
    status.actor?.username ||
    getActorIdMention(status.actorId)

  return (
    <div className="flex items-center gap-2 mb-1 text-sm text-muted-foreground ml-12">
      <Repeat2 className="size-4" />
      <span>Boosted by {actorName}</span>
    </div>
  )
}

export const Post: FC<PostProps> = (props) => {
  const { host, status, onShowAttachment, collapsible, postLineLimit } = props
  const actualStatus = getActualStatus(status)
  // Held here because the chips and the action-row trigger are two halves of
  // one control. An Announce wrapper carries no reactions of its own — they
  // live on the boosted status, which is what `getActualStatus` resolves to.
  const reactionState = useReactionState({
    currentActor: props.showActions ? props.currentActor : undefined,
    status: actualStatus,
    onReactionsChanged: props.onReactionsChanged
  })
  // The same gate `Actions` applies to itself, hoisted so the chip row above it
  // knows whether there will be an action row under it to align with.
  const showsActionRow = Boolean(props.showActions && props.currentActor)
  const externalStatusUrl = actualStatus.url || actualStatus.id
  const showExternalLink =
    !actualStatus.isLocalActor && Boolean(externalStatusUrl)
  const relativeCreatedAt = formatDistance(
    actualStatus.createdAt,
    props.currentTime
  )
  const actorName = actualStatus.actor
    ? actualStatus.actor.name || actualStatus.actor.username
    : null
  const openStatusLabel = actorName
    ? `Open status by ${actorName}, posted ${relativeCreatedAt} ago`
    : `Open status, posted ${relativeCreatedAt} ago`
  const timestampClassName = 'text-muted-foreground text-xs whitespace-nowrap'

  const processedAndCleanedText = _.chain(actualStatus)
    .thru((s) => processStatusText(host, s))
    .thru(cleanClassName)
    .value()
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
    props.currentActor?.id === actualStatus.actorId
  const summary = actualStatus.summary?.trim()
  // Only offer translation to signed-in viewers (the API needs a token); this
  // keeps the public landing feed free of dead Translate buttons. Prefer the
  // content-detected language over the declared one: a post mislabeled (or
  // defaulted) to the viewer's language but actually written in another one
  // would otherwise never offer the control, and a post mislabeled the other
  // way would show a dead en→en-equivalent button. See
  // lib/services/language-detection.
  const translationLanguage = props.currentActor
    ? (actualStatus.detectedLanguage ?? actualStatus.language)
    : null
  const statusBody = (
    <TranslationProvider
      // Reset translation state cleanly if a mounted Post is reused for a
      // different status (e.g. in a virtualized feed).
      key={actualStatus.id}
      statusId={actualStatus.id}
      language={translationLanguage}
    >
      <TranslateContent
        statusId={actualStatus.id}
        language={translationLanguage}
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
              <div className="mt-2 flex items-center gap-2 text-destructive">
                <span>
                  {fitnessRetryVariant === 'stuck'
                    ? 'Processing is taking longer than expected. The original activity file is still available.'
                    : 'Processing failed. The original activity file is still available.'}
                </span>
              </div>
            )
          ) : null}

          {fitnessMapRetryVariant && isOwner ? (
            <RetryFitnessButton
              statusId={actualStatus.id}
              variant={fitnessMapRetryVariant}
            />
          ) : null}

          {isFitnessCompleted && fitnessStats.length > 0 ? (
            <FitnessStatGrid variant="chip" className="mt-2.5">
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
            </FitnessStatGrid>
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
        currentTime={props.currentTime}
        currentActorId={props.currentActor?.id}
      />
      <Attachments status={actualStatus} onMediaSelected={onShowAttachment} />
      {/* The link card yields to any richer representation of what the post is
          about — media, a quoted post, or a fitness activity — rather than
          stacking a second block under it. This is the display rule Mastodon
          applies; the card is still stored and still served over the API, so a
          client is free to decide otherwise. */}
      {actualStatus.linkPreview &&
      !actualStatus.quote &&
      !actualStatus.fitness &&
      actualStatus.attachments.length === 0 ? (
        <LinkPreviewCard linkPreview={actualStatus.linkPreview} />
      ) : null}
      {actualStatus.quote ? (
        <QuoteCard quote={actualStatus.quote} currentTime={props.currentTime} />
      ) : null}
    </TranslationProvider>
  )

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <BoostStatus status={status} />
      <div className="flex min-w-0 gap-3">
        <div className="shrink-0">
          <ActorAvatar
            actor={actualStatus.actor}
            actorId={actualStatus.actorId}
            statusUrl={actualStatus.url}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
            <ActorInfo
              actor={actualStatus.actor}
              actorId={actualStatus.actorId}
              statusUrl={actualStatus.url}
            />
            <span className="text-muted-foreground">·</span>
            {props.onOpenStatus ? (
              <button
                type="button"
                className={`${timestampClassName} -mx-1 inline-flex min-h-8 items-center rounded-sm px-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
                aria-label={openStatusLabel}
                onClick={() => {
                  props.onOpenStatus?.(status)
                }}
              >
                {relativeCreatedAt}
              </button>
            ) : (
              <span className={timestampClassName}>{relativeCreatedAt}</span>
            )}
            {showExternalLink && (
              <a
                href={externalStatusUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground"
                aria-label="Open original post"
                title="Open original post"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>

          {summary ? (
            <ContentWarning summary={summary}>{statusBody}</ContentWarning>
          ) : (
            statusBody
          )}

          <div>
            {/* Chips sit between the content and the action row: they belong to
                the post, not to the actions, and a logged-out reader still sees
                them (read-only) while the action row is hidden. They go
                full-bleed only when that row is there to align with — on a
                read-only surface the row beneath them is `ReadOnlyStats`, which
                starts at the text, and chips hanging 52px further left would
                line up with nothing. */}
            <ReactionRow state={reactionState} fullBleed={showsActionRow} />
            <Actions {...props} reactionState={reactionState} />
            {props.showReadOnlyStats && !props.showActions && (
              <ReadOnlyStats status={status} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
