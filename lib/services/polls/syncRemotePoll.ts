import { getNote } from '@/lib/activities'
import { getContent, getSummary } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { ENTITY_TYPE_QUESTION, Question } from '@/lib/types/activitypub'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusPoll, StatusType } from '@/lib/types/domain/status'
import {
  normalizeActivityPubContent,
  normalizeActivityPubUri
} from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'
import { withSpan } from '@/lib/utils/trace'

const FAILURE_COOLDOWN_MS = 60 * 1000
const REFRESH_WAIT_BUDGET_MS = 5_000

const inflightPollSyncs = new Map<string, Promise<StatusPoll | null>>()
const failedPollSyncsAt = new Map<string, number>()

export const resetSyncRemotePollStateForTesting = () => {
  inflightPollSyncs.clear()
  failedPollSyncsAt.clear()
}

const raceWithBudget = <T>(promise: Promise<T>, budgetMs: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs)
  })
  return Promise.race([promise, budget]).finally(() => clearTimeout(timer))
}

const performPollSync = async ({
  database,
  status,
  signingActor
}: {
  database: Database
  status: StatusPoll
  signingActor?: Actor
}): Promise<StatusPoll | null> => {
  try {
    const signer =
      signingActor ??
      (await getFederationSigningActor(database).catch(() => undefined))

    const remoteData = await getNote({
      statusId: status.id,
      signingActor: signer
    })
    if (!remoteData) {
      failedPollSyncsAt.set(status.id, Date.now())
      return null
    }

    const parseResult = Question.safeParse(
      normalizeActivityPubContent(remoteData)
    )
    if (
      !parseResult.success ||
      parseResult.data.type !== ENTITY_TYPE_QUESTION
    ) {
      failedPollSyncsAt.set(status.id, Date.now())
      return null
    }

    const question = parseResult.data

    // A fetched document's `id` is SELF-REPORTED by the remote server, and
    // `updatePoll` resolves its target with a bare `where('id', ?)` — no
    // ownership filter, no type filter. So a hostile server answering this
    // poll's own URL with a document claiming an unrelated status's id would
    // rewrite that status's text, spoiler and choice tallies and record a
    // `status_history` revision that reads as a genuine edit by its author,
    // local users included. Trust only the id we asked for: a mismatch is a
    // failed sync, not a document to apply to this row. Normalized on both
    // sides so a benign serialization difference — scheme/host case, an
    // explicit default port, dot segments, or a character the URL parser must
    // percent-ENCODE (a non-ASCII username in the path) — is not mistaken for
    // a substitution. It does not percent-DECODE, so `%7E` and `~` still
    // differ; that is deliberate here, where the id we fetch is the origin's
    // own canonical id and should come back spelled the way we stored it.
    if (
      normalizeActivityPubUri(question.id) !==
      normalizeActivityPubUri(status.id)
    ) {
      logger.warn({
        message: 'Ignoring a remote poll whose id does not match the request',
        statusId: status.id,
        remoteStatusId: question.id
      })
      failedPollSyncsAt.set(status.id, Date.now())
      return null
    }

    const choices =
      question.oneOf?.map((answer) => ({
        title: answer.name,
        totalVotes: answer.replies?.totalItems ?? 0
      })) ??
      question.anyOf?.map((answer) => ({
        title: answer.name,
        totalVotes: answer.replies?.totalItems ?? 0
      })) ??
      []

    const text = getContent(question)
    const summary = getSummary(question)
    const endAt = question.endTime
      ? new Date(question.endTime).getTime()
      : undefined

    const updated = await database.updatePoll({
      // The id-match guard above already proves these are the same poll; using
      // `status.id` keeps the write target correct by construction rather than
      // by that guard alone, and matches the row this sync was asked about.
      statusId: status.id,
      summary,
      text,
      choices,
      ...(endAt !== undefined ? { endAt } : {})
    })

    failedPollSyncsAt.delete(status.id)
    return (updated as StatusPoll) ?? status
  } catch (error) {
    logger.warn({
      message: 'Failed to sync remote poll',
      statusId: status.id,
      error: error instanceof Error ? error.message : String(error)
    })
    failedPollSyncsAt.set(status.id, Date.now())
    return null
  }
}

export const syncRemotePoll = async ({
  database,
  status,
  signingActor
}: {
  database: Database
  status: Status
  signingActor?: Actor
}): Promise<Status> =>
  withSpan('service', 'syncRemotePoll', { statusId: status.id }, async () => {
    if (status.type !== StatusType.enum.Poll || status.isLocalActor) {
      return status
    }

    const failedAt = failedPollSyncsAt.get(status.id)
    if (failedAt && Date.now() - failedAt < FAILURE_COOLDOWN_MS) {
      return status
    }

    let inflight = inflightPollSyncs.get(status.id)
    if (!inflight) {
      inflight = performPollSync({ database, status, signingActor }).finally(
        () => {
          inflightPollSyncs.delete(status.id)
        }
      )
      inflightPollSyncs.set(status.id, inflight)
    }

    const synced = await raceWithBudget(inflight, REFRESH_WAIT_BUDGET_MS)
    return synced ?? status
  })
