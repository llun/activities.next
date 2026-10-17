import { z } from 'zod'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { RECEIVE_FLAG_JOB_NAME } from '@/lib/jobs/names'
import { actorMatchesVerifiedSender } from '@/lib/jobs/verifiedSender'
import { getDomainFromUrl } from '@/lib/services/federation/domainPolicy'
import { isFederationSigningActor } from '@/lib/services/federation/instanceActor'
import { JobHandle } from '@/lib/services/queue/type'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// Mastodon keeps `content[0...5000]` of a forwarded report.
const MAX_COMMENT_LENGTH = 5000

// Mastodon files one report per local account in `object`; bound the work a
// single Flag can cause.
const MAX_TARGETS = 20

export const JobData = z.object({
  id: z.string().optional(),
  actor: z.string(),
  object: z.array(z.string()),
  content: z.string().optional()
})

/**
 * An inbound Flag: a report another server forwards to this one. Mirrors
 * Mastodon's `ActivityPub::Activity::Flag`. `object` is the reported
 * account(s) and optionally the reported statuses. One report is filed for
 * every LOCAL, non-suspended account named, each with only that account's own
 * LOCAL statuses. A Flag that names no such account is ignored. (Mastodon also
 * accepts a report about a remote account whose posts reply to a local
 * account; this server does not.) The reporter is the Flag's `actor`, bound to
 * the verified signer and often a server's instance actor (a
 * `Service`/`Application`), so the report is not attributed to one person on
 * the origin. A reporter on a domain block with `rejectReports` is ignored,
 * whatever the block's severity.
 *
 * The reports table has no column for a remote origin: a report whose
 * `actorId` is a remote actor is a forwarded report. Redelivery is absorbed by
 * the queue's job id (derived from the activity id). On top of that, an
 * identical report (same reporter, same target, same comment, same statuses)
 * is skipped while the earlier one is unresolved, so a retry after the queue's
 * dedup window cannot double-create. This also means identical reports from
 * the same server collapse into one until the first is resolved.
 */
export const receiveFlagJob: JobHandle = createJobHandle(
  RECEIVE_FLAG_JOB_NAME,
  async (database, message) => {
    const parsed = JobData.safeParse(message.data)
    if (!parsed.success) return
    const { actor, object, content } = parsed.data
    if (!actorMatchesVerifiedSender(actor, message)) return

    const domain = getDomainFromUrl(actor)
    if (domain) {
      const block = await database.getDomainBlockForDomain(domain)
      if (block?.rejectReports) return
    }

    const uris = [...new Set(object)]

    // Accounts first, so a long list of statuses cannot push them out.
    const targetIds: string[] = []
    for (const uri of uris) {
      if (targetIds.length >= MAX_TARGETS) break
      const candidate = await database.getActorFromId({ id: uri })
      // The instance actor signs federation traffic; it is not a person to
      // report.
      if (candidate?.privateKey && !isFederationSigningActor(candidate)) {
        targetIds.push(candidate.id)
      }
    }
    if (targetIds.length === 0) return

    // Mastodon: `next if target_account.suspended?`.
    const states = await database.getModerationStatesForActors({
      actorIds: targetIds
    })
    const targets = targetIds.filter((id) => !states.get(id)?.suspendedAt)
    if (targets.length === 0) return

    const statusIdsByTarget = new Map<string, string[]>()
    for (const uri of uris) {
      const status = await database.getStatus({
        statusId: uri,
        withReplies: false
      })
      if (!status?.isLocalActor || !targets.includes(status.actorId)) continue
      const ids = statusIdsByTarget.get(status.actorId) ?? []
      ids.push(status.id)
      statusIdsByTarget.set(status.actorId, ids)
    }

    // The reporter must exist as an actor row: the admin report view joins on
    // it, and an unresolvable one would make the report unserializable.
    let reporter: Awaited<ReturnType<typeof recordActorIfNeeded>>
    try {
      reporter = await recordActorIfNeeded({ actorId: actor, database })
    } catch (error) {
      logger.warn({
        message: 'Failed to record the reporter of an inbound Flag',
        actorId: actor,
        err: toLoggableError(error)
      })
      return
    }
    if (!reporter) {
      logger.info({
        message: 'Ignored an inbound Flag: the reporter could not be recorded',
        actorId: actor
      })
      return
    }

    const comment = (content ?? '').slice(0, MAX_COMMENT_LENGTH)
    for (const targetActorId of targets) {
      const statusIds = statusIdsByTarget.get(targetActorId) ?? []
      const existing = await database.getAdminReports({
        accountId: reporter.id,
        targetActorId,
        resolved: false
      })
      const duplicate = existing.some(
        (report) =>
          report.comment === comment &&
          report.statusIds.length === statusIds.length &&
          report.statusIds.every((id) => statusIds.includes(id))
      )
      if (duplicate) continue

      await database.createReport({
        actorId: reporter.id,
        targetActorId,
        // Mastodon files a forwarded report under "other" unless it cites rules.
        category: 'other',
        comment,
        statusIds
      })
    }
  }
)
