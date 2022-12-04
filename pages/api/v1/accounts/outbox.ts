import { createNoteFromUserInput } from '../../../../lib/actions/createNote'
import { sendNote } from '../../../../lib/activities'
import { ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'

const handler = ApiGuard(async (req, res, context) => {
  const { currentActor, storage } = context
  switch (req.method) {
    case 'POST': {
      const body = req.body
      const { status, note } = await createNoteFromUserInput({
        currentActor,
        text: body.message,
        replyNoteId: body.replyStatus?.id,
        storage
      })
      const hosts = await storage.getFollowersHosts({
        targetActorId: currentActor.id
      })
      await Promise.all(
        hosts.map((host) => {
          // TODO: Get this from profile
          const sharedInbox = `https://${host}/inbox`
          return sendNote({
            currentActor,
            sharedInbox,
            note
          })
        })
      )
      return res.status(200).json({ status, note })
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})

export default handler
