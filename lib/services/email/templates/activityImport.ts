import { getConfig } from '@/lib/config'
import {
  EmailStat,
  button,
  headline,
  paragraph,
  statCard
} from '@/lib/services/email/layout/blocks'
import { renderEmail } from '@/lib/services/email/layout/renderEmail'
import { RenderedEmail } from '@/lib/services/email/types'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { ActorProfile, getMention } from '@/lib/types/domain/actor'
import { EditableStatus } from '@/lib/types/domain/status'
import {
  formatFitnessDistance,
  formatFitnessDuration,
  getFitnessPaceOrSpeed
} from '@/lib/utils/fitness'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'

import { getEmailStatusUrl } from './statusUrl'

export interface ActivityImportEmailParams {
  /** The actor whose activity was imported — receives this email. */
  recipient: ActorProfile
  /** The status the import created. */
  status: EditableStatus
  /** The parsed fitness file, when the import produced one. */
  fitness?: FitnessFile
  /** Absolute URL of the stored route map, when the activity had one. */
  mapImageUrl?: string
}

const MAX_TITLE_LENGTH = 80

/**
 * Title for the stat card, taken from the status the import created.
 *
 * Deliberately derived from the post rather than from any provider's activity
 * payload, so a Strava webhook, a direct .fit upload and a future integration
 * all produce the same email.
 */
const getActivityTitle = (
  status: EditableStatus,
  fitness?: FitnessFile
): string => {
  const firstLine = htmlToPlainText(status.text)
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  if (firstLine) {
    // Iterate code POINTS, not code units: these captions routinely lead with
    // an emoji (buildActivitySummary emits one per activity type), and slicing
    // a string mid-surrogate leaves a lone half that renders as a replacement
    // character in the mail client.
    const characters = Array.from(firstLine)
    return characters.length > MAX_TITLE_LENGTH
      ? `${characters
          .slice(0, MAX_TITLE_LENGTH - 1)
          .join('')
          .trimEnd()}…`
      : firstLine
  }

  const activityType = fitness?.activityType?.trim()
  if (activityType) {
    return activityType.charAt(0).toUpperCase() + activityType.slice(1)
  }
  return 'Fitness activity'
}

const formatStartTime = (fitness?: FitnessFile, fallback?: number): string => {
  const timestamp = fitness?.activityStartTime ?? fallback
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  })
}

/**
 * Distance, elapsed time, and pace-or-speed.
 *
 * Every field is optional — an indoor session has no distance, and a file that
 * failed to parse has none of them — so each stat is dropped individually and
 * the card is skipped entirely when nothing survives.
 */
const getStats = (fitness?: FitnessFile): EmailStat[] => {
  if (!fitness) return []

  const stats: EmailStat[] = []
  const distance = formatFitnessDistance(fitness.totalDistanceMeters)
  if (distance) stats.push({ label: 'Distance', value: distance })

  const duration = formatFitnessDuration(fitness.totalDurationSeconds)
  if (duration) stats.push({ label: 'Time', value: duration })

  // Returns 'Pace' for a run or walk and 'Avg speed' for a ride, so the column
  // heading follows the activity rather than being hardcoded.
  const paceOrSpeed = getFitnessPaceOrSpeed({
    distanceMeters: fitness.totalDistanceMeters,
    durationSeconds: fitness.totalDurationSeconds,
    movingTimeSeconds: fitness.movingTimeSeconds,
    activityType: fitness.activityType
  })
  if (paceOrSpeed) {
    stats.push({ label: paceOrSpeed.label, value: paceOrSpeed.value })
  }

  return stats
}

/**
 * A background import finished and created a post.
 *
 * Everything rendered comes from the status and its fitness file, and none of
 * the COPY names a provider — the same template serves a Strava webhook, a
 * direct .fit upload and any future integration.
 *
 * The one place a provider name can surface is the footnote, which prints the
 * real file name: a Strava import stores `strava-<activityId>.tcx`. That is the
 * user's own file, not wording we chose, and hiding it would make the footnote
 * lie about which file produced the post.
 */
export const buildActivityImportEmail = ({
  recipient,
  status,
  fitness,
  mapImageUrl
}: ActivityImportEmailParams): RenderedEmail => {
  const stats = getStats(fitness)
  const hasCard = Boolean(mapImageUrl) || stats.length > 0 || Boolean(fitness)

  return renderEmail({
    subject: `Your fitness activity was imported in ${getConfig().host}`,
    preheader:
      'Your fitness activity has been imported and posted as a status.',
    blocks: [
      headline('Your fitness activity was imported'),
      paragraph(
        'Your fitness activity has been imported. A status with the route and stats was created on your profile — open it to view or share.'
      ),
      ...(hasCard
        ? [
            statCard({
              mapImageUrl,
              title: getActivityTitle(status, fitness),
              timestamp: formatStartTime(fitness, status.createdAt),
              stats,
              footnote: fitness?.fileName
                ? `Imported from activity file · ${fitness.fileName}`
                : undefined
            })
          ]
        : []),
      button({ label: 'View status', url: getEmailStatusUrl(status) })
    ],
    footer: {
      kind: 'notification',
      eventLabel: 'fitness imports',
      handle: getMention(recipient, true)
    }
  })
}
