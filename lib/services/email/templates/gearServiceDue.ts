import { getBaseURL, getConfig } from '@/lib/config'
import {
  EmailStat,
  button,
  headline,
  paragraph,
  statCard
} from '@/lib/services/email/layout/blocks'
import { renderEmail } from '@/lib/services/email/layout/renderEmail'
import { RenderedEmail } from '@/lib/services/email/types'
import { ActorProfile, getMention } from '@/lib/types/domain/actor'

export interface GearServiceDueEmailParams {
  /** The gear's owner — receives this email. */
  recipient: ActorProfile
  /** Gear id, used to link straight to its page. */
  gearId: string
  /** Display name of the bike or pair of shoes. */
  gearName: string
  /**
   * The part that is due, when the reminder is for a component rather than the
   * gear itself (e.g. "Chain"). Absent for a shoes distance alert.
   */
  componentName?: string
  /** Derived lifetime distance at the moment the threshold was crossed. */
  totalDistanceMeters: number
  /** The distance the owner asked to be reminded at. */
  thresholdMeters: number
}

const formatKilometres = (meters: number): string =>
  `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Math.round(meters / 1000))} km`

/**
 * A piece of gear has passed the distance its owner asked to be reminded at.
 *
 * Sent once per crossing: the service records the distance it alerted at, and
 * only a raised threshold, a replacement part or a retire/unretire re-arms it.
 * The copy therefore states the fact and links to the gear rather than nagging.
 */
export const buildGearServiceDueEmail = ({
  recipient,
  gearId,
  gearName,
  componentName,
  totalDistanceMeters,
  thresholdMeters
}: GearServiceDueEmailParams): RenderedEmail => {
  const subjectName = componentName
    ? `${gearName} · ${componentName}`
    : gearName
  const stats: EmailStat[] = [
    { label: 'Distance', value: formatKilometres(totalDistanceMeters) },
    { label: 'Reminder at', value: formatKilometres(thresholdMeters) }
  ]

  return renderEmail({
    subject: `${subjectName} has passed ${formatKilometres(thresholdMeters)} in ${getConfig().host}`,
    preheader: `${subjectName} has reached the distance you set a reminder for.`,
    blocks: [
      headline('Your gear is due for service'),
      paragraph(
        componentName
          ? `The ${componentName.toLowerCase()} on ${gearName} has passed the distance you set a reminder for. Replacing it from the gear page starts the next one at zero.`
          : `${gearName} has passed the distance you set a reminder for. Most shoes wear out between 500 and 800 km — it may be time for a new pair.`
      ),
      statCard({
        title: subjectName,
        stats
      }),
      button({
        label: 'View gear',
        url: `${getBaseURL()}/fitness/gear/${encodeURIComponent(gearId)}`
      })
    ],
    footer: {
      kind: 'notification',
      eventLabel: 'gear service reminders',
      handle: getMention(recipient, true)
    }
  })
}
