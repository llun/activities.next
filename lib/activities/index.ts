import { Note } from '@llun/activities.schema'
import crypto from 'crypto'

import { AcceptFollow } from '@/lib/activities/actions/acceptFollow'
import { AnnounceStatus } from '@/lib/activities/actions/announceStatus'
import { CreateStatus } from '@/lib/activities/actions/createStatus'
import { DeleteStatus } from '@/lib/activities/actions/deleteStatus'
import { FollowRequest } from '@/lib/activities/actions/follow'
import { LikeStatus } from '@/lib/activities/actions/like'
import { RejectFollow } from '@/lib/activities/actions/rejectFollow'
import {
  AnnounceAction,
  CreateAction,
  DeleteAction,
  UndoAction,
  UpdateAction
} from '@/lib/activities/actions/types'
import { UndoFollow } from '@/lib/activities/actions/undoFollow'
import { UndoLike } from '@/lib/activities/actions/undoLike'
import { UndoStatus } from '@/lib/activities/actions/undoStatus'
import { UpdateStatus } from '@/lib/activities/actions/updateStatus'
import { DEFAULT_ACCEPT } from '@/lib/activities/constants'
import { getActorPerson } from '@/lib/activities/requests/getActorPerson'
import { Actor } from '@/lib/models/actor'
import { Follow } from '@/lib/models/follow'
import {
  Status,
  StatusAnnounce,
  StatusPoll,
  StatusType
} from '@/lib/models/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_URL
} from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { signedHeaders } from '@/lib/utils/signature'
import { getTracer } from '@/lib/utils/trace'

interface GetNoteParams {
  statusId: string
}
export const getNote = async ({
  statusId
}: GetNoteParams): Promise<Note | null> =>
  getTracer().startActiveSpan(
    'activities.getNote',
    { attributes: { statusId } },
    async (span) => {
      try {
        const { statusCode, body } = await request({
          url: statusId,
          headers: { Accept: DEFAULT_ACCEPT }
        })
        if (statusCode !== 200) return null
        return JSON.parse(body)
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        if (nodeError.code === 'ETIMEDOUT') {
          span.setAttribute('timeout', true)
          return
        }

        span.recordException(nodeError)
        logger.error(`[getNote] ${nodeError.message}`)
        return null
      } finally {
        span.end()
      }
    }
  )

interface SendNoteParams {
  currentActor: Actor
  inbox: string
  note: Note
}
export const sendNote = async ({ currentActor, inbox, note }: SendNoteParams) =>
  getTracer().startActiveSpan(
    'activities.sendNote',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      const activity: CreateStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: note.id,
        type: CreateAction,
        actor: note.attributedTo,
        published: note.published,
        to: note.to,
        cc: note.cc,
        object: note
      }
      const method = 'POST'
      try {
        await request({
          url: inbox,
          method,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              inbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        if (nodeError.code === 'ETIMEDOUT') {
          span.setAttribute('timeout', true)
          return
        }

        span.recordException(nodeError)
        logger.error(`[sendNote] ${nodeError.message}`)
      } finally {
        span.end()
      }
    }
  )

interface SendUpdateNoteParams {
  currentActor: Actor
  inbox: string
  status: Status
}
export const sendUpdateNote = async ({
  currentActor,
  inbox,
  status
}: SendUpdateNoteParams) =>
  getTracer().startActiveSpan(
    'activities.sendUpdateNote',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      const note = getNoteFromStatus(status)
      if (!note) {
        span.end()
        return
      }

      const activity: UpdateStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${note.id}#updates/${Date.now()}`,
        type: UpdateAction,
        actor: note.attributedTo,
        published: getISOTimeUTC(status.updatedAt),
        to: note.to,
        cc: note.cc,
        object: note
      }
      const method = 'POST'
      try {
        await request({
          url: inbox,
          method,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              inbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        if (nodeError.code === 'ETIMEDOUT') {
          span.setAttribute('timeout', true)
          return
        }

        span.recordException(nodeError)
        logger.error(`[sendUpdateNote] ${nodeError.message}`)
      } finally {
        span.end()
      }
    }
  )

interface SendAnnounceParams {
  currentActor: Actor
  inbox: string
  status: Status
}
export const sendAnnounce = async ({
  currentActor,
  inbox,
  status
}: SendAnnounceParams) =>
  getTracer().startActiveSpan(
    'activities.sendAnnounce',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      if (status.type !== StatusType.enum.Announce) {
        span.end()
        return null
      }

      const activity: AnnounceStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${status.id}/activity`,
        type: AnnounceAction,
        actor: status.actorId,
        published: getISOTimeUTC(status.createdAt),
        to: status.to,
        cc: status.cc,
        object: status.originalStatus.id
      }
      const method = 'POST'
      try {
        await request({
          url: inbox,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              inbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          method,
          body: JSON.stringify(activity)
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        if (nodeError.code === 'ETIMEDOUT') {
          span.setAttribute('timeout', true)
          return
        }

        span.recordException(nodeError)
        logger.error(`[sendAnnounce] ${nodeError.message}`)
      } finally {
        span.end()
      }
    }
  )

interface DeleteStatusParams {
  currentActor: Actor
  inbox: string
  statusId: string
}
export const deleteStatus = async ({
  currentActor,
  inbox,
  statusId
}: DeleteStatusParams) =>
  getTracer().startActiveSpan(
    'activities.deleteStatus',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      const activity: DeleteStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${statusId}#delete`,
        type: DeleteAction,
        actor: currentActor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        object: {
          id: statusId,
          type: 'Tombstone'
        }
      }
      const method = 'POST'
      try {
        await request({
          url: inbox,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              inbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          method,
          body: JSON.stringify(activity)
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        if (nodeError.code === 'ETIMEDOUT') {
          span.setAttribute('timeout', true)
          return
        }

        span.recordException(nodeError)
        logger.error(`[deleteStatus] ${nodeError.message}`)
      } finally {
        span.end()
      }
    }
  )

interface UndoAnnounceParams {
  currentActor: Actor
  inbox: string
  announce: StatusAnnounce
}
export const undoAnnounce = async ({
  currentActor,
  inbox,
  announce
}: UndoAnnounceParams) =>
  getTracer().startActiveSpan(
    'activities.undoAnnounce',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      const activity: UndoStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${announce.id}#undo`,
        type: UndoAction,
        actor: currentActor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        object: {
          id: `${announce.id}/activity`,
          type: AnnounceAction,
          actor: announce.actorId,
          published: getISOTimeUTC(announce.createdAt),
          to: announce.to,
          cc: announce.cc,
          object: announce.originalStatus.id
        }
      }
      const method = 'POST'
      try {
        await request({
          url: inbox,
          method,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              inbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        if (nodeError.code === 'ETIMEDOUT') {
          span.setAttribute('timeout', true)
          return
        }

        span.recordException(nodeError)
        logger.error(`[undoAnnounce] ${nodeError.message}`)
      } finally {
        span.end()
      }
    }
  )

export const follow = async (
  id: string,
  currentActor: Actor,
  targetActorId: string
) =>
  getTracer().startActiveSpan(
    'activities.follow',
    {
      attributes: {
        id,
        actorId: currentActor.id,
        targetActorId
      }
    },
    async (span) => {
      const activity: FollowRequest = {
        '@context': ACTIVITY_STREAM_URL,
        id: `https://${currentActor.domain}/${id}`,
        type: 'Follow',
        actor: currentActor.id,
        object: targetActorId
      }
      const person = await getActorPerson({ actorId: targetActorId })
      const targetInbox = person?.inbox
      if (!targetInbox) {
        span.end()
        return false
      }

      const method = 'POST'
      try {
        const { statusCode } = await request({
          url: targetInbox,
          method,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              targetInbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
        return statusCode === 202
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[follow] ${nodeError.message}`)
        return false
      } finally {
        span.end()
      }
    }
  )

export const unfollow = async (currentActor: Actor, follow: Follow) =>
  getTracer().startActiveSpan(
    'activities.unfollow',
    {
      attributes: {
        actorId: currentActor.id,
        follow: follow.id
      }
    },
    async (span) => {
      const activity: UndoFollow = {
        '@context': ACTIVITY_STREAM_URL,
        id: `https://${currentActor.domain}/${currentActor.id}#follows/${follow.id}/undo`,
        type: 'Undo',
        actor: currentActor.id,
        object: {
          id: `https://${currentActor.domain}/${follow.id}`,
          type: 'Follow',
          actor: follow.actorId,
          object: follow.targetActorId
        }
      }

      const person = await getActorPerson({ actorId: follow.targetActorId })
      const targetInbox = person?.inbox ?? `${follow.targetActorId}/inbox`

      const method = 'POST'
      try {
        const { statusCode } = await request({
          url: targetInbox,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              targetInbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          method,
          body: JSON.stringify(activity)
        })
        return statusCode === 202
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[unfollow] ${nodeError.message}`)
        return false
      } finally {
        span.end()
      }
    }
  )

export const acceptFollow = async (
  currentActor: Actor,
  followingInbox: string,
  followRequest: FollowRequest
) =>
  getTracer().startActiveSpan(
    'activities.acceptFollow',
    {
      attributes: {
        actorId: currentActor.id,
        followingInbox
      }
    },
    async (span) => {
      const activity: AcceptFollow = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${currentActor.id}#accepts/followers`,
        type: 'Accept',
        actor: currentActor.id,
        object: {
          id: followRequest.id,
          type: 'Follow',
          actor: followRequest.actor,
          object: followRequest.object
        }
      }
      const method = 'POST'
      try {
        const { statusCode } = await request({
          url: followingInbox,
          method,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              followingInbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
        return statusCode === 202
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[acceptFollow] ${nodeError.message}`)
        return false
      } finally {
        span.end()
      }
    }
  )

export const rejectFollow = async (
  currentActor: Actor,
  followingInbox: string,
  followRequest: FollowRequest
) =>
  getTracer().startActiveSpan(
    'activities.rejectFollow',
    {
      attributes: {
        actorId: currentActor.id,
        followingInbox
      }
    },
    async (span) => {
      const activity: RejectFollow = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${currentActor.id}#rejects/followers`,
        type: 'Reject',
        actor: currentActor.id,
        object: {
          id: followRequest.id,
          type: 'Follow',
          actor: followRequest.actor,
          object: followRequest.object
        }
      }
      const method = 'POST'
      try {
        const { statusCode } = await request({
          url: followingInbox,
          method,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              followingInbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
        return statusCode === 202
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[rejectFollow] ${nodeError.message}`)
        return false
      } finally {
        span.end()
      }
    }
  )

const statusIdHash = (statusId: string) =>
  crypto.createHash('md5').update(statusId).digest('hex')

interface LikeParams {
  currentActor: Actor
  status: Status
}
export const sendLike = async ({ currentActor, status }: LikeParams) =>
  getTracer().startActiveSpan(
    'activities.sendLike',
    { attributes: { actorId: currentActor.id, statusId: status.id } },
    async (span) => {
      if (!status.actor) return

      const activity: LikeStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${currentActor.id}#likes/${statusIdHash(status.id)}`,
        type: 'Like',
        actor: currentActor.id,
        object: status.id
      }
      const method = 'POST'
      try {
        await request({
          method,
          url: status.actor.inboxUrl,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              status.actor.inboxUrl,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[sendLike] ${nodeError.message}`)
      } finally {
        span.end()
      }
    }
  )

interface UndoLikeParams {
  currentActor: Actor
  status: Status
}
export const sendUndoLike = async ({ currentActor, status }: UndoLikeParams) =>
  getTracer().startActiveSpan(
    'activities.sendUndoLike',
    { attributes: { actorId: currentActor.id, statusId: status.id } },
    async (span) => {
      if (!status.actor) return

      const activity: UndoLike = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${currentActor.id}/#likes/${statusIdHash(status.id)}/undo`,
        type: 'Undo',
        actor: currentActor.id,
        object: {
          id: `${currentActor.id}/#likes/${statusIdHash(status.id)}`,
          type: 'Like',
          actor: currentActor.id,
          object: status.id
        }
      }
      const method = 'POST'
      try {
        await request({
          method,
          url: status.actor.inboxUrl,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              status.actor.inboxUrl,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[sendUndoLike] ${nodeError.message}`)
      } finally {
        span.end()
      }
    }
  )

interface SendPollVotesParams {
  currentActor: Actor
  status: StatusPoll
  choices: number[]
}

export const sendPollVotes = async ({
  currentActor,
  status,
  choices
}: SendPollVotesParams) =>
  getTracer().startActiveSpan(
    'activities.sendPollVotes',
    {
      attributes: {
        actorId: currentActor.id,
        statusId: status.id,
        choices: choices.join(',')
      }
    },
    async (span) => {
      if (!status.actor) return

      for (const choiceIndex of choices) {
        const choice = status.choices[choiceIndex]
        if (!choice) continue

        const voteId = `${currentActor.id}#votes/${crypto.randomUUID()}`

        const voteNote = {
          id: voteId,
          type: 'Note' as const,
          attributedTo: currentActor.id,
          inReplyTo: status.id,
          name: choice.title,
          to: [status.actorId],
          cc: [],
          tag: [],
          published: getISOTimeUTC(Date.now())
        }

        const activity: CreateStatus = {
          '@context': ACTIVITY_STREAM_URL,
          id: `${voteId}/activity`,
          type: CreateAction,
          actor: currentActor.id,
          published: voteNote.published,
          to: voteNote.to,
          cc: [],
          object: voteNote
        }

        const method = 'POST'
        try {
          await request({
            url: status.actor.inboxUrl,
            method,
            headers: {
              ...signedHeaders(
                currentActor,
                method.toLowerCase(),
                status.actor.inboxUrl,
                activity
              ),
              Accept: DEFAULT_ACCEPT
            },
            body: JSON.stringify(activity)
          })
        } catch (error) {
          const nodeError = error as NodeJS.ErrnoException
          span.recordException(nodeError)
          logger.error(`[sendPollVotes] ${nodeError.message}`)
        }
      }

      span.end()
    }
  )
