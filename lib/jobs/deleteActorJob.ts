import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { sendMail } from '@/lib/services/email'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/actorDeleted'

import { createJobHandle } from './createJobHandle'
import { DELETE_ACTOR_JOB_NAME } from './names'

const DeleteActorJobData = z.object({
  actorId: z.string()
})

export const deleteActorJob = createJobHandle(
  DELETE_ACTOR_JOB_NAME,
  async (database, message) => {
    const data = DeleteActorJobData.parse(message.data)
    const { actorId } = data

    // Get the actor before deletion to use for email
    const actor = await database.getActorFromId({ id: actorId })
    if (!actor) {
      return
    }

    // Check if deletion was cancelled before proceeding
    if (actor.deletionStatus !== 'scheduled') {
      // Deletion was cancelled or already processed, exit early
      return
    }

    // Store email for notification before deletion
    const accountEmail = actor.account?.email

    // Mark actor as deleting
    await database.startActorDeletion({ actorId })

    // Delete all actor data
    await database.deleteActorData({ actorId })

    // Send email notification
    if (accountEmail) {
      const config = getConfig()
      if (config.email) {
        await sendMail({
          from: config.email.serviceFromAddress,
          to: [accountEmail],
          subject: getSubject(actor),
          content: {
            text: getTextContent(actor),
            html: getHTMLContent(actor)
          }
        })
      }
    }
  }
)
