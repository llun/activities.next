import { Database } from '@/lib/database/types'
import { buildGearServiceDueEmail } from '@/lib/services/email/templates/gearServiceDue'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import {
  FitnessGear,
  FitnessGearComponent
} from '@/lib/types/database/fitnessGear'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export interface EvaluateGearServiceRemindersParams {
  database: Database
  actorId: string
  /** The gear whose totals just changed. Empty is a no-op. */
  gearIds: string[]
}

interface DueReminder {
  gear: FitnessGear
  componentId?: string
  componentName?: string
  totalDistanceMeters: number
  thresholdMeters: number
}

/**
 * A threshold has been crossed when the derived total has reached it and no
 * alert has been sent at or beyond it.
 *
 * Comparing against the recorded alert distance rather than a boolean is what
 * makes a raised threshold re-arm on its own: an owner who moves a reminder
 * from 650 km to 800 km gets told again at 800 km, without anything having to
 * reset a flag.
 */
const hasCrossed = (
  totalDistanceMeters: number,
  thresholdMeters?: number,
  lastAlertedDistanceMeters?: number
): boolean => {
  if (!thresholdMeters || thresholdMeters <= 0) return false
  if (totalDistanceMeters < thresholdMeters) return false
  return (
    lastAlertedDistanceMeters === undefined ||
    lastAlertedDistanceMeters < thresholdMeters
  )
}

const notifyGearServiceDue = async (
  database: Database,
  actorId: string,
  reminder: DueReminder
) => {
  const actor = await database.getActorFromId({ id: actorId })
  if (!actor) {
    // The crossing was computed and is about to be dropped; say so rather than
    // returning into silence.
    logger.warn({
      message: 'Cannot deliver a gear service reminder: actor not found',
      actorId,
      gearId: reminder.gear.id
    })
    return
  }

  const notification = await createNotificationWithPolicy(database, {
    actorId,
    type: 'gear_service_due',
    // Self-addressed — there is no other party involved, and the guard
    // resolves the source actor for the push payload from this id.
    sourceActorId: actorId
  })
  if (!notification || notification.filtered) return

  sendNotificationAlerts({
    database,
    actorId,
    sourceActorId: actorId,
    sourceActor: actor,
    events: [
      {
        type: 'gear_service_due',
        notificationId: notification.id,
        emailContent: actor.account
          ? {
              recipientEmail: actor.account.email,
              ...buildGearServiceDueEmail({
                recipient: actor,
                gearId: reminder.gear.id,
                gearName: reminder.gear.name,
                componentName: reminder.componentName,
                totalDistanceMeters: reminder.totalDistanceMeters,
                thresholdMeters: reminder.thresholdMeters
              })
            }
          : undefined
      }
    ]
  })
}

/**
 * Checks the given gear (and, for a bike, each installed component) against its
 * service threshold and sends one reminder per crossing.
 *
 * Evaluated on write rather than on a schedule: this instance has no recurring
 * job infrastructure — the queue can delay a message but not repeat one — so
 * the reminder is computed at the moments a total can actually change, namely
 * when an activity finishes processing and when one is attributed to gear by
 * hand. Both call sites treat this as best-effort.
 *
 * Retired gear is skipped: its total is frozen by the absence of new
 * activities, and telling someone to service a bike they have put away is
 * noise.
 */
export const evaluateGearServiceReminders = async ({
  database,
  actorId,
  gearIds
}: EvaluateGearServiceRemindersParams): Promise<void> => {
  const uniqueGearIds = [...new Set(gearIds)].filter(Boolean)
  if (uniqueGearIds.length === 0) return

  try {
    const gears = (
      await Promise.all(
        uniqueGearIds.map((id) => database.getFitnessGear({ id, actorId }))
      )
    ).filter((gear): gear is FitnessGear => Boolean(gear) && !gear?.retiredAt)
    if (gears.length === 0) return

    const activeGearIds = gears.map((gear) => gear.id)

    // Nothing to evaluate unless a threshold exists somewhere. This runs once
    // per processed activity, so an archive import of a few thousand rides
    // would otherwise issue several queries each to re-derive totals that
    // cannot produce a reminder. The component read is the cheap way to know,
    // and it is the same query the loop below would run anyway.
    const componentsByGearId = new Map<string, FitnessGearComponent[]>()
    for (const gear of gears) {
      componentsByGearId.set(
        gear.id,
        await database.getFitnessGearComponents({
          gearId: gear.id,
          actorId
        })
      )
    }
    const hasAnyThreshold = gears.some(
      (gear) =>
        gear.alertDistanceMeters ||
        componentsByGearId
          .get(gear.id)
          ?.some(
            (component) =>
              !component.removedAt && component.serviceDistanceMeters
          )
    )
    if (!hasAnyThreshold) return

    const [gearRollups, componentRollups] = await Promise.all([
      database.getFitnessGearDistanceRollups({
        actorId,
        gearIds: activeGearIds
      }),
      database.getFitnessGearComponentDistanceRollups({
        actorId,
        gearIds: activeGearIds
      })
    ])

    const due: DueReminder[] = []

    for (const gear of gears) {
      const total = gearRollups[gear.id]?.distanceMeters ?? 0
      if (
        hasCrossed(
          total,
          gear.alertDistanceMeters,
          gear.lastAlertedDistanceMeters
        )
      ) {
        due.push({
          gear,
          totalDistanceMeters: total,
          thresholdMeters: gear.alertDistanceMeters as number
        })
      }

      for (const component of componentsByGearId.get(gear.id) ?? []) {
        // A part that has been replaced is history; only what is fitted now can
        // become due.
        if (component.removedAt) continue

        const componentTotal =
          componentRollups[component.id]?.distanceMeters ?? 0
        if (
          hasCrossed(
            componentTotal,
            component.serviceDistanceMeters,
            component.lastAlertedDistanceMeters
          )
        ) {
          due.push({
            gear,
            componentId: component.id,
            componentName: component.componentType,
            totalDistanceMeters: componentTotal,
            thresholdMeters: component.serviceDistanceMeters as number
          })
        }
      }
    }

    for (const reminder of due) {
      // Claim the crossing before notifying, and let the WRITE decide whether
      // this evaluation owns it. Two evaluations racing on the same gear both
      // read `lastAlerted` as null, so a read-based check would send two
      // identical emails; the conditional update lets exactly one through.
      const claimed = reminder.componentId
        ? await database.setFitnessGearComponentLastAlertedDistance({
            id: reminder.componentId,
            lastAlertedDistanceMeters: reminder.totalDistanceMeters,
            onlyIfBelowThresholdMeters: reminder.thresholdMeters
          })
        : await database.setFitnessGearLastAlertedDistance({
            id: reminder.gear.id,
            lastAlertedDistanceMeters: reminder.totalDistanceMeters,
            onlyIfBelowThresholdMeters: reminder.thresholdMeters
          })
      if (!claimed) continue

      // Contained per reminder: a delivery failure on one must not skip the
      // rest of the batch. The claim above is deliberately not rolled back — a
      // duplicate reminder is worse than a missed one, and the next threshold
      // (or a replacement part) re-arms it.
      try {
        await notifyGearServiceDue(database, actorId, reminder)
      } catch (error) {
        logger.error({
          message: 'Failed to deliver a gear service reminder',
          actorId,
          gearId: reminder.gear.id,
          componentId: reminder.componentId,
          err: toLoggableError(error)
        })
      }
    }
  } catch (error) {
    // A reminder is a courtesy on top of whatever the caller was doing —
    // importing an activity or attributing one to gear — and must never fail it.
    logger.error({
      message: 'Failed to evaluate gear service reminders',
      actorId,
      err: toLoggableError(error)
    })
  }
}
