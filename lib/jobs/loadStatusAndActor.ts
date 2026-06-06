import { Span } from '@opentelemetry/api'

import { Database } from '@/lib/database/types'

type LoadedStatus = Awaited<ReturnType<Database['getStatus']>>
type LoadedActor = Awaited<ReturnType<Database['getActorFromId']>>

/**
 * Shared loader for status-delivery jobs: records the `actorId`/`statusId` span
 * attributes and fetches both entities in parallel. Callers keep their own
 * not-found guard so job-specific error messages and extra checks (e.g. status
 * type) stay intact.
 */
export const loadStatusAndActor = async (
  database: Database,
  span: Span,
  { actorId, statusId }: { actorId: string; statusId: string }
): Promise<{ status: LoadedStatus; actor: LoadedActor }> => {
  span.setAttribute('actorId', actorId)
  span.setAttribute('statusId', statusId)

  const [status, actor] = await Promise.all([
    database.getStatus({ statusId, withReplies: false }),
    database.getActorFromId({ id: actorId })
  ])

  return { status, actor }
}
