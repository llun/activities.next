import { getNote } from '@/lib/activities'
import { getContent, getSummary } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { ENTITY_TYPE_QUESTION, Question } from '@/lib/types/activitypub'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusPoll, StatusType } from '@/lib/types/domain/status'
import { normalizeActivityPubContent } from '@/lib/utils/activitypub'
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
      statusId: question.id,
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
