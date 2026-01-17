import { SpanStatusCode } from '@opentelemetry/api'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { sendMail } from '@/lib/services/email'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/actorDeleted'
import { logger } from '@/lib/utils/logger'
import { getSpan } from '@/lib/utils/trace'

import { createJobHandle } from './createJobHandle'
import { DELETE_ACTOR_JOB_NAME } from './names'

const DeleteActorJobData = z.object({
  actorId: z.string()
})

export const deleteActorJob = createJobHandle(
  DELETE_ACTOR_JOB_NAME,
  async (database, message) => {
    const span = getSpan('job', 'deleteActor')
    logger.info({
      message: 'Delete actor job started',
      messageId: message.id,
      data: message.data
    })

    let data
    try {
      data = DeleteActorJobData.parse(message.data)
    } catch (err) {
      logger.error({
        message: 'Invalid delete actor job data',
        messageId: message.id,
        data: message.data,
        err: err instanceof Error ? err : new Error(String(err))
      })
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'Invalid job data'
      })
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      span.end()
      throw err
    }

    const { actorId } = data
    span.setAttribute('actorId', actorId)
    logger.info({
      message: 'Processing delete actor job',
      actorId
    })

    // Get the actor before deletion to use for email
    let actor
    try {
      actor = await database.getActorFromId({ id: actorId })
      logger.debug({
        message: 'Retrieved actor for deletion',
        actorId,
        found: !!actor
      })
    } catch (err) {
      logger.error({
        message: 'Failed to get actor for deletion',
        actorId,
        err: err instanceof Error ? err : new Error(String(err))
      })
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'Failed to get actor'
      })
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      span.end()
      throw err
    }

    if (!actor) {
      logger.warn({
        message: 'Actor not found for deletion job',
        actorId
      })
      span.setStatus({ code: SpanStatusCode.OK, message: 'Actor not found' })
      span.end()
      return
    }

    // Check if deletion was cancelled before proceeding
    if (actor.deletionStatus !== 'scheduled') {
      logger.info({
        message: 'Actor deletion was cancelled or already processed',
        actorId,
        currentStatus: actor.deletionStatus
      })
      span.setStatus({
        code: SpanStatusCode.OK,
        message: 'Deletion cancelled or processed'
      })
      span.end()
      return
    }

    // Store email for notification before deletion
    const accountEmail = actor.account?.email
    logger.debug({
      message: 'Actor email for notification',
      actorId,
      hasEmail: !!accountEmail
    })

    // Mark actor as deleting
    try {
      await database.startActorDeletion({ actorId })
      logger.info({
        message: 'Marked actor as deleting',
        actorId
      })
    } catch (err) {
      logger.error({
        message: 'Failed to mark actor as deleting',
        actorId,
        err: err instanceof Error ? err : new Error(String(err))
      })
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'Failed to start deletion'
      })
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      span.end()
      throw err
    }

    // Delete all actor data
    try {
      await database.deleteActorData({ actorId })
      logger.info({
        message: 'Deleted actor data',
        actorId
      })
    } catch (err) {
      logger.error({
        message: 'Failed to delete actor data',
        actorId,
        err: err instanceof Error ? err : new Error(String(err))
      })
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'Failed to delete actor data'
      })
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      span.end()
      throw err
    }

    // Send email notification
    if (accountEmail) {
      const config = getConfig()
      if (config.email) {
        try {
          await sendMail({
            from: config.email.serviceFromAddress,
            to: [accountEmail],
            subject: getSubject(actor),
            content: {
              text: getTextContent(actor),
              html: getHTMLContent(actor)
            }
          })
          logger.info({
            message: 'Sent actor deletion email notification',
            actorId,
            email: accountEmail
          })
        } catch (err) {
          logger.error({
            message: 'Failed to send actor deletion email notification',
            actorId,
            email: accountEmail,
            err: err instanceof Error ? err : new Error(String(err))
          })
          // Don't fail the job if email fails
        }
      }
    }

    logger.info({
      message: 'Delete actor job completed successfully',
      actorId
    })
    span.setStatus({ code: SpanStatusCode.OK })
    span.end()
  }
)
