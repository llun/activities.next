import { z } from 'zod'

import { unblock } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_UNBLOCK_JOB_NAME } from '@/lib/jobs/names'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { JobHandle } from '@/lib/services/queue/type'
import { Block } from '@/lib/types/domain/block'
import { getTracer } from '@/lib/utils/trace'

export const JobData = z.object({
  actorId: z.string(),
  block: Block
})

export const sendUnblockJob: JobHandle = createJobHandle(
  SEND_UNBLOCK_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('sendUnblockJob', async (span) => {
      const { actorId, block } = JobData.parse(message.data)
      span.setAttribute('actorId', actorId)
      span.setAttribute('blockId', block.id)

      if (!(await canFederateWithDomain(database, block.targetActorId))) {
        span.end()
        return
      }

      const [currentActor, signingActor] = await Promise.all([
        database.getActorFromId({ id: actorId }),
        getFederationSigningActor(database)
      ])
      if (!currentActor) {
        span.recordException(new Error('Actor not found'))
        span.end()
        return
      }

      const ok = await unblock(currentActor, block, signingActor)
      if (!ok) {
        const error = new Error('Failed to send Undo Block')
        span.recordException(error)
        span.end()
        throw error
      }
      span.end()
    })
  }
)
