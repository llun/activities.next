'use client'

import { Activity, Calendar, ExternalLink, type LucideIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { CSSProperties, FC, useMemo } from 'react'

import { Actions } from '@/lib/components/posts/actions/actions'
import { ActorAvatar } from '@/lib/components/posts/actor'
import { Attachments } from '@/lib/components/posts/attachments'
import { InlineStatusComposer } from '@/lib/components/posts/lazy-inline-status-composer'
import { ReactionRow } from '@/lib/components/posts/reaction-row'
import { useInlineComposer } from '@/lib/components/posts/useInlineComposer'
import { useReactionState } from '@/lib/components/posts/useReactionState'
import { Alert } from '@/lib/components/surface/Alert'
import {
  StatStrip,
  type StatStripColumns
} from '@/lib/components/surface/StatStrip'
import { getGearKindForActivityType } from '@/lib/services/fitness-files/sportTypes'
import { ActorProfile, getMention } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import {
  getFitnessSourceLabel,
  normalizeFitnessSourceUrl
} from '@/lib/utils/fitness'
import { getVisibility } from '@/lib/utils/getVisibility'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { processStatusText } from '@/lib/utils/text/processStatusText'

import { ActivityGearMeta } from './ActivityGearMeta'
import { ActivityReplies } from './ActivityReplies'
import { ActivityStartTime } from './ActivityStartTime'
import { RecordingLine } from './FitnessRecordingPicker'
import { StatusStatStrip } from './StatusStatStrip'
import { VISIBILITY_META, getActivityLabel } from './activityLabels'
import type { FitnessGearAssignment } from './useFitnessGearAssignment'
import type { MakePrimaryRecording } from './useMakePrimaryRecording'
import type { StatusFitnessFiles } from './useStatusFitnessFiles'

/**
 * Which attachment is the route map the server rendered for this activity:
 * the one named "route map", else the first attachment of a file with map
 * data, else none. The post's media strip leaves it out (the Overview section
 * draws the route itself, falling back to this image).
 */
export const getRouteMapAttachmentIndex = (
  attachments: Attachment[],
  hasMapData: boolean
): number => {
  const named = attachments.findIndex((attachment) =>
    attachment.name.toLowerCase().includes('route map')
  )
  if (named >= 0) return named
  if (hasMapData && attachments.length > 0) return 0
  return -1
}

/**
 * The post body's side padding, written three ways that must agree: the body's
 * padding class, the figure band's negative margin that bleeds it back out to
 * the edges, and the CSS length the media strip bleeds by. Tailwind needs the
 * class names spelled out, so they are literals here; a test ties them to the
 * same length.
 */
export const POST_BODY_PADDING_CLASS = 'p-4'
export const POST_BAND_BLEED_CLASS = '-mx-4'
export const POST_MEDIA_BLEED = '1rem'

export interface ActivityTile {
  key: string
  label: string
  icon: LucideIcon
  value: string
  unit?: string
  accent?: boolean
}

/**
 * One of the post's headline figures: a small uppercase label with its icon,
 * the value, and its unit under it. It is a cell of the edge-to-edge band, so
 * it has no border or radius of its own: the band's 1px gaps draw the dividers.
 */
const ActivityTileCell: FC<{ tile: ActivityTile }> = ({ tile }) => {
  const Icon = tile.icon
  return (
    <div
      data-testid={`activity-tile-${tile.key}`}
      className="grid min-w-0 gap-0.5 bg-background px-4 py-3"
    >
      <span className="flex items-center gap-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{tile.label}</span>
      </span>
      <span
        className={cn(
          'text-2xl font-semibold whitespace-nowrap tabular-nums',
          // After the size class: tailwind-merge reads `text-2xl` as setting a
          // line height too, and would drop an earlier `leading-*`.
          'leading-tight',
          tile.accent && 'text-primary-text'
        )}
      >
        {tile.value}
      </span>
      {tile.unit ? (
        <span className="text-xs text-muted-foreground">{tile.unit}</span>
      ) : null}
    </div>
  )
}

export interface ActivityPostFrameProps {
  host: string
  currentTime: number
  currentActor?: ActorProfile | null
  status: StatusNote
  replies: Status[]
  isMediaUploadEnabled?: boolean
  isOwner: boolean
  files: StatusFitnessFiles
  gear: FitnessGearAssignment
  primary: MakePrimaryRecording
  /** Index of the route map image in `status.attachments`, or -1. */
  mapAttachmentIndex: number
  tiles: ActivityTile[]
  onShowAttachment: (allMedias: Attachment[], selectedIndex: number) => void
}

/**
 * The activity's post: who and when, the recording it is drawn from, the
 * caption, the photos (the status media strip), the headline figures, the
 * reactions and action row, and the replies under them.
 *
 * It is laid out like the focused post on the post page, not as a box inside
 * the page card: flush under the page header, no border or radius of its own,
 * sections divided by full-width hairlines. The headline figures are an
 * edge-to-edge band. The line between the post and the sections under it belongs
 * to the sections column (its `border-t`), not to the post, so an empty column
 * takes the line with it.
 */
export const ActivityPostFrame: FC<ActivityPostFrameProps> = ({
  host,
  currentTime,
  currentActor,
  status,
  replies,
  isMediaUploadEnabled,
  isOwner,
  files,
  gear,
  primary,
  mapAttachmentIndex,
  tiles,
  onShowAttachment
}) => {
  const router = useRouter()
  const { fitness, fitnessFiles, setSelectedFitnessFileId } = files
  // Reply, edit and quote share one composer, so only one is ever open. Reply
  // opens it at the top of the replies; edit and quote under the action row.
  const composer = useInlineComposer(Boolean(currentActor))
  // This page lays out its own post, so it holds the reaction rollups the way
  // `Post` does: the chips under the figures and the picker in the action row
  // read this one state.
  const reactionState = useReactionState({
    currentActor: currentActor ?? undefined,
    status
  })

  const actorName = status.actor?.name || status.actor?.username || 'Athlete'
  const actorHandle = status.actor ? getMention(status.actor, true) : null
  const activityLabel = getActivityLabel(fitness?.activityType ?? undefined)
  const activityStartTime = fitness?.activityStartTime ?? status.createdAt
  const visibilityMeta =
    VISIBILITY_META[getVisibility(status.to, status.cc)] ??
    VISIBILITY_META.public
  const VisibilityIcon = visibilityMeta.icon
  const fitnessSourceUrl = normalizeFitnessSourceUrl(fitness?.sourceUrl)
  // The caption goes through the same pipeline `Post` uses, so it looks
  // exactly like this post's caption in the timeline. Memoized: it re-parses
  // HTML and the page re-renders on every chart hover.
  const caption = useMemo(
    () =>
      cleanClassName(processStatusText(host, status), {
        host,
        tags: status.tags
      }),
    [host, status]
  )
  // The post's own media strip, without the route map image: the Overview
  // section shows the route.
  const mediaStatus = useMemo<StatusNote>(
    () =>
      mapAttachmentIndex >= 0
        ? {
            ...status,
            attachments: status.attachments.filter(
              (_, index) => index !== mapAttachmentIndex
            )
          }
        : status,
    [mapAttachmentIndex, status]
  )
  // Owner only, matching the endpoint: the raw upload carries the whole track,
  // including the ends a privacy location trims off, so it 404s for anyone
  // else. It follows the selected recording.
  const sourceHref =
    isOwner && fitness?.id
      ? `/api/v1/fitness-files/${encodeURIComponent(fitness.id)}`
      : undefined

  const hasReactions = reactionState.reactions.length > 0

  const isEditingOrQuoting =
    Boolean(currentActor) &&
    composer.active?.anchorId === status.id &&
    composer.active.mode !== 'reply'

  return (
    // No `overflow-hidden`: the action row's error tooltips and its
    // edit-history panel do not portal, so a clip here would cut them off.
    <article
      data-slot="fitness-card"
      className={cn(
        'bg-background',
        // Signed out there is no `Header` above the post (the page card has
        // only an `sr-only` heading), so the post is what meets the card's top
        // corners, and its background would paint over them if square. Signed
        // in, the header's own clipped wrapper takes them. The bottom corners
        // are always round: if the sections column below is empty and hidden,
        // the post is the card's last child. Otherwise the matching
        // backgrounds hide it.
        'rounded-b-lg',
        !currentActor && 'rounded-t-lg'
      )}
    >
      <div
        className={cn(
          POST_BODY_PADDING_CLASS,
          // The figure band ends the body and the action row's `border-t` is
          // the one line under it, so the body must not pad below it. With
          // reaction chips after the band, the band draws its own `border-b`
          // and the chips sit in the padded space under it instead.
          tiles.length > 0 && !hasReactions && 'pb-0'
        )}
        style={
          {
            // The media strip runs to the post's edges: it bleeds out by the
            // body's own padding on each side.
            '--post-media-bleed-left': POST_MEDIA_BLEED,
            '--post-media-bleed-right': POST_MEDIA_BLEED
          } as CSSProperties
        }
      >
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            <ActorAvatar
              actor={status.actor}
              actorId={status.actorId}
              statusUrl={status.url}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{actorName}</div>
            {actorHandle ? (
              <div className="truncate text-xs text-muted-foreground">
                {actorHandle}
              </div>
            ) : null}
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary-text">
            <Activity className="size-3.5 text-primary" /> {activityLabel}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="size-3.5" />{' '}
            <ActivityStartTime timestamp={activityStartTime} />
          </span>
          <span aria-hidden="true">·</span>
          <span
            className="inline-flex items-center gap-1.5"
            title={visibilityMeta.label}
          >
            <VisibilityIcon className="size-3.5" /> {visibilityMeta.label}
          </span>
          <ActivityGearMeta
            isOwner={isOwner}
            gearId={gear.selectedGearId}
            gearName={fitness?.gearName ?? null}
            distanceMeters={gear.assignedGear?.distanceMeters ?? null}
            kind={
              gear.assignedGear?.kind ??
              getGearKindForActivityType(fitness?.activityType)
            }
          />
        </div>

        {gear.gearErrorMessage ? (
          <p
            id="activity-gear-error"
            className="mt-1 text-xs text-destructive"
            role="alert"
          >
            {gear.gearErrorMessage}
          </p>
        ) : null}

        <RecordingLine
          files={fitnessFiles}
          selected={fitness}
          isOwner={isOwner}
          downloadHref={sourceHref}
          triggerRef={primary.recordingTriggerRef}
          onSelect={setSelectedFitnessFileId}
          onMakePrimary={(fileId) => void primary.handleMakePrimary(fileId)}
          makingPrimaryId={primary.makingPrimaryId}
        />

        {/* The failure is an Alert with a Retry for the same file. Pending and
            done share one live region that is always mounted (empty when
            idle): a region added together with its text is not reliably
            announced, one that already exists and then changes is. */}
        {primary.primaryError ? (
          <Alert
            className="mt-2"
            title={primary.primaryError.message}
            onRetry={primary.retryMakePrimary}
          />
        ) : null}
        <p
          role="status"
          className={cn(
            'text-xs text-muted-foreground',
            (primary.makingPrimaryId || primary.primaryNotice) && 'mt-1'
          )}
        >
          {primary.makingPrimaryId
            ? 'Making this the primary recording…'
            : (primary.primaryNotice ?? '')}
        </p>

        {fitnessSourceUrl ? (
          <div className="mt-1 text-sm">
            <a
              href={fitnessSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              <ExternalLink className="size-3.5 shrink-0" />
              {getFitnessSourceLabel(fitnessSourceUrl)}
            </a>
          </div>
        ) : null}

        <div className="mt-3 text-sm leading-relaxed break-words markdown-content">
          {caption}
        </div>

        <Attachments
          status={mediaStatus}
          onMediaSelected={(medias, index) => onShowAttachment(medias, index)}
        />

        {tiles.length > 0 ? (
          <StatStrip
            variant="band"
            data-testid="activity-figure-band"
            columns={Math.min(tiles.length, 5) as StatStripColumns}
            className={cn(
              POST_BAND_BLEED_CLASS,
              'mt-4 border-t',
              hasReactions && 'border-b'
            )}
          >
            {tiles.map((tile) => (
              <ActivityTileCell key={tile.key} tile={tile} />
            ))}
          </StatStrip>
        ) : null}

        {hasReactions ? (
          // Gated on the wrapper: the row renders nothing on an unreacted post,
          // and an ungated wrapper would leave dead space under the figures.
          <div data-testid="reaction-chips">
            <ReactionRow state={reactionState} />
          </div>
        ) : null}
      </div>

      <div className="border-t px-4 py-2.5">
        {/* The shared action row: the same actions and spacing as every other
            surface. `fullBleed` off because this footer's padding already
            puts the row at the post's left edge. `Actions` renders nothing
            without a viewer, so a signed-out visitor gets the read-only
            counts in its place rather than an empty footer. */}
        {currentActor ? (
          <Actions
            host={host}
            currentActor={currentActor}
            currentTime={currentTime}
            status={status}
            showActions
            fullBleed={false}
            reactionState={reactionState}
            editable={isOwner}
            extraMenuItems={gear.gearMenuItems}
            // Always a reply to this post: the page is the post itself.
            onReply={() => composer.openReply(status, status.id)}
            onEdit={(target) => composer.openEdit(target, status.id)}
            onQuote={(target) => composer.openQuote(target, status.id)}
            onShowAttachment={onShowAttachment}
          />
        ) : (
          <StatusStatStrip
            boosts={status.totalShares ?? 0}
            likes={status.totalLikes ?? 0}
            replies={replies.length}
          />
        )}
      </div>

      {/* Edit and quote open under the post they change, as in the timeline.
          The `key` remounts it when the mode changes rather than carrying a
          quote's draft into an edit. */}
      {isEditingOrQuoting && currentActor && composer.active ? (
        <div className="px-4 pb-4">
          <InlineStatusComposer
            key={`${composer.active.mode}-${composer.active.anchorId}`}
            host={host}
            profile={currentActor}
            mode={composer.active.mode}
            status={composer.active.status}
            isMediaUploadEnabled={isMediaUploadEnabled}
            onCancel={composer.close}
            onCreated={() => router.refresh()}
            onUpdated={() => router.refresh()}
          />
        </div>
      ) : null}

      <ActivityReplies
        host={host}
        currentActor={currentActor}
        currentTime={currentTime}
        status={status}
        replies={replies}
        isMediaUploadEnabled={isMediaUploadEnabled}
        composer={composer}
        onShowAttachment={onShowAttachment}
      />
    </article>
  )
}
